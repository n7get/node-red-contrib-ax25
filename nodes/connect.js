"use strict";

const { errorEnvelope, okEnvelope } = require("../lib/message-utils");
const store = require("../lib/runtime-store");

function parseWaitFor(pattern) {
  if (!pattern || typeof pattern !== "string" || pattern.trim() === "") return null;
  try {
    return new RegExp(pattern);
  } catch (e) {
    return null;
  }
}

function normalizeViaCallsigns(value) {
  if (!value) return [];
  if (typeof value === "string") {
    return value.split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map(function (entry) {
      return typeof entry === "string" ? entry.trim() : (entry && entry.callsign ? String(entry.callsign).trim() : "");
    }).filter(Boolean);
  }
  return [];
}

// Lazily initialise shared inbound-data routing maps on context so both connect and
// send can coordinate without a bus round-trip.
//   outputClaims  : sessionId -> { node, waitFor: RegExp|null }
//   lineBuffers   : sessionId -> partial-line string
//   waitForBuffers: sessionId -> string[]
function ensureConnBuffers(context) {
  if (!context.outputClaims) context.outputClaims = new Map();
  if (!context.lineBuffers) context.lineBuffers = new Map();
  if (!context.waitForBuffers) context.waitForBuffers = new Map();
  // lifecycleClaims tracks which connect node receives lifecycle events (port 1) for each
  // session. Unlike outputClaims (data, port 2), this is set at connect time and never
  // transferred to a send node, ensuring disconnected/connected always reach the right node.
  if (!context.lifecycleClaims) context.lifecycleClaims = new Map();
}

// Deliver one inbound frame to `node`, applying line buffering and optional waitFor.
function deliverFrame(context, node, sessionId, frame) {
  const session = context.registry.get(context.instanceId, sessionId);
  const mode = (session && session.mode) || "binary";

  if (mode === "binary") {
    node.send([null, okEnvelope({
      instanceId: context.instanceId,
      sessionId,
      event: "data",
      payload: frame.payload,
      source: frame.source,
      destination: frame.destination,
      via: frame.via || []
    })]);
    return;
  }

  // Line mode: buffer fragments and split on CR or CR+LF.
  const prev = context.lineBuffers.get(sessionId) || "";
  const combined = prev + frame.payload.toString();
  const lines = combined.split(/\r\n|\r/);
  context.lineBuffers.set(sessionId, lines.pop()); // last element is incomplete fragment

  const claim = context.outputClaims.get(sessionId);
  const waitFor = claim ? claim.waitFor : null;

  if (!waitFor) {
    lines.forEach(function (line) {
      node.send([null, okEnvelope({
        instanceId: context.instanceId,
        sessionId,
        event: "data",
        payload: line,
        source: frame.source,
        destination: frame.destination,
        via: frame.via || []
      })]);
    });
  } else {
    // Accumulate lines until the first one matching waitFor, then emit all at once.
    const buf = context.waitForBuffers.get(sessionId) || [];
    buf.push.apply(buf, lines);

    let matchIdx = -1;
    for (let i = 0; i < buf.length; i++) {
      if (waitFor.test(buf[i])) {
        matchIdx = i;
        break;
      }
    }

    if (matchIdx >= 0) {
      const outLines = buf.splice(0, matchIdx + 1);
      const match = outLines.pop();
      context.waitForBuffers.set(sessionId, buf);
      const timerEntry = context.sessionTimers && context.sessionTimers.get(sessionId);
      if (timerEntry) { clearTimeout(timerEntry.t); context.sessionTimers.delete(sessionId); }
      node.send([null, okEnvelope({
        instanceId: context.instanceId,
        sessionId,
        event: "data",
        payload: outLines,
        match,
        source: frame.source,
        destination: frame.destination,
        via: frame.via || []
      })]);
    } else {
      // Also check the current line fragment (e.g. a BBS prompt with no trailing CR/LF).
      const fragment = context.lineBuffers.get(sessionId) || "";
      if (fragment && waitFor.test(fragment)) {
        context.lineBuffers.set(sessionId, "");
        context.waitForBuffers.delete(sessionId);
        const timerEntry = context.sessionTimers && context.sessionTimers.get(sessionId);
        if (timerEntry) { clearTimeout(timerEntry.t); context.sessionTimers.delete(sessionId); }
        node.send([null, okEnvelope({
          instanceId: context.instanceId,
          sessionId,
          event: "data",
          payload: buf,
          match: fragment,
          source: frame.source,
          destination: frame.destination,
          via: frame.via || []
        })]);
      } else {
        context.waitForBuffers.set(sessionId, buf);
      }
    }
  }
}

function syncTransportStatus(node, context) {
  if (context._reconnectTimer) {
    node.status({ fill: "yellow", shape: "ring", text: "reconnecting..." });
  } else if (context.state === "connecting") {
    node.status({ fill: "yellow", shape: "dot", text: "connecting" });
  } else if (context.state === "connected") {
    node.status({ fill: "green", shape: "dot", text: "ready" });
  } else if (context.state === "failed") {
    node.status({ fill: "red", shape: "dot", text: "failed" });
  } else {
    node.status({ fill: "grey", shape: "ring", text: "disconnected" });
  }
}

module.exports = function (RED) {
  function ConnectNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const cfg = RED.nodes.getNode(config.client);
    const context = cfg ? cfg.instance : null;
    if (!context) {
      node.status({ fill: "red", shape: "ring", text: "client missing" });
      return;
    }

    ensureConnBuffers(context);
    syncTransportStatus(node, context);

    // sessionTimers lives on the shared context so multiple Connect nodes in the same
    // flow all see and cancel each other's timers — preventing duplicate timeout events
    // when more than one Connect node subscribes to conn-timeout-set.
    if (!context.sessionTimers) context.sessionTimers = new Map();

    // Tracks sessions initiated by this node that have not yet received a "connected"
    // confirmation. A "disconnected" event for a pending session means the attempt failed.
    const pendingConnections = new Set();

    function clearTimer(sessionId) {
      const entry = context.sessionTimers.get(sessionId);
      if (entry !== undefined) {
        clearTimeout(entry.t);
        context.sessionTimers.delete(sessionId);
      }
    }

    function startTimer(sessionId, timeoutMs) {
      clearTimer(sessionId);
      if (!timeoutMs || timeoutMs <= 0) return;
      const t = setTimeout(function () {
        context.sessionTimers.delete(sessionId);
        // Fire through whichever node currently holds the output claim (may be a Send node).
        const claim = context.outputClaims && context.outputClaims.get(sessionId);
        const targetNode = (claim && claim.node) || node;
        const session = context.registry.get(context.instanceId, sessionId);
        const mode = (session && session.mode) || "binary";
        const fields = { instanceId: context.instanceId, sessionId, event: "timeout" };
        if (mode === "line" && claim && claim.waitFor) {
          fields.waitFor = claim.waitFor.source;
          fields.lineBuffer = context.lineBuffers ? (context.lineBuffers.get(sessionId) || "") : "";
          fields.waitForBuffer = context.waitForBuffers ? (context.waitForBuffers.get(sessionId) || []) : [];
        }
        targetNode.send([errorEnvelope("TIMEOUT", "Inactivity timeout", fields), null]);
      }, timeoutMs);
      if (typeof t.unref === "function") t.unref();
      context.sessionTimers.set(sessionId, { t, nodeId: node.id });
    }

    function resetTimer(sessionId) {
      if (!context.sessionTimers.has(sessionId)) return;
      const session = context.registry.get(context.instanceId, sessionId);
      if (session && session.timeoutMs > 0) {
        startTimer(sessionId, session.timeoutMs);
      }
    }

    const onLifecycle = function (event) {
      if (event.event === "transport-connecting") {
        node.status({ fill: "yellow", shape: "dot", text: "connecting" });
        return;
      }
      if (event.event === "transport-connected") {
        node.status({ fill: "green", shape: "dot", text: "ready" });
        return;
      }
      if (event.event === "transport-reconnecting") {
        node.status({ fill: "yellow", shape: "ring", text: "reconnecting..." });
        return;
      }
      if (event.event === "transport-closed") {
        node.status({ fill: "grey", shape: "ring", text: "disconnected" });
        return;
      }
      if (event.event === "failed") {
        node.status({ fill: "red", shape: "dot", text: "failed" });
        return;
      }

      // Transport-level events (no sessionId) are not session events — don't forward.
      if (!event.sessionId) {
        return;
      }

      if (event.event === "collision") {
        node.send([
          errorEnvelope("SESSION_ID_REUSED", "Server session ID collision detected", {
            instanceId: context.instanceId,
            sessionId: event.sessionId,
            serverSessionId: event.serverSessionId
          }),
          null
        ]);
        return;
      }

      // lifecycleClaims tracks which connect node owns lifecycle events (port 1) for
      // each session. It is set at connect time and never transferred to send nodes,
      // ensuring that connected/disconnected always go to the originating connect node
      // regardless of who currently holds the data output claim (outputClaims).
      const lifecycleClaim = context.lifecycleClaims && context.lifecycleClaims.get(event.sessionId);

      // If the owning handler already ran in this emit() call, it sets the claim to null
      // as a sentinel. Skip to avoid duplicate output from subsequent handlers.
      if (lifecycleClaim !== undefined && lifecycleClaim === null) return;

      // If a different node owns lifecycle for this session, skip everything.
      if (lifecycleClaim !== undefined && lifecycleClaim !== node) return;

      if (event.event === "connected") {
        pendingConnections.delete(event.sessionId);
        const session = context.registry.get(context.instanceId, event.sessionId);
        if (session && session.timeoutMs > 0) {
          startTimer(event.sessionId, session.timeoutMs);
        }
      }

      if (event.event === "disconnected" || event.event === "disconnecting") {
        const sessionId = event.sessionId;
        clearTimer(sessionId);
        // Flush any pending waitFor buffer to whatever node currently holds the data
        // output claim (may be a send node that took over from this connect node).
        const dataClaim = context.outputClaims && context.outputClaims.get(sessionId);
        const pendingBuf = context.waitForBuffers.get(sessionId);
        if (pendingBuf && pendingBuf.length > 0 && dataClaim && dataClaim.node) {
          dataClaim.node.send([null, okEnvelope({
            instanceId: context.instanceId,
            sessionId,
            event: "data",
            payload: pendingBuf
          })]);
        }
        context.waitForBuffers.delete(sessionId);
        context.lineBuffers.delete(sessionId);
        context.outputClaims && context.outputClaims.delete(sessionId);
        // Only set the null sentinel for the final "disconnected" event (prevents duplicate
        // delivery when multiple connect nodes share a bus). Do NOT set it for
        // "disconnecting" — the TNC confirmation ("disconnected") must still be delivered.
        if (event.event === "disconnected") {
          store.unindexSession(sessionId);
          context.lifecycleClaims.set(sessionId, null);
          setImmediate(function () {
            if (context.lifecycleClaims.get(sessionId) === null) {
              context.lifecycleClaims.delete(sessionId);
            }
          });
        }
      }

      if (event.event === "disconnected" && pendingConnections.has(event.sessionId)) {
        pendingConnections.delete(event.sessionId);
        node.send([
          errorEnvelope("CONNECT_FAILED", "Connection attempt failed", {
            instanceId: context.instanceId,
            sessionId: event.sessionId,
            source: event.source,
            destination: event.destination
          }),
          null
        ]);
        return;
      }

      node.send([
        okEnvelope({
          instanceId: context.instanceId,
          sessionId: event.sessionId,
          event: event.event,
          source: event.source,
          destination: event.destination,
          called: event.called
        }),
        null
      ]);
    };

    const onData = function (frame) {
      if (frame.event === "connect" || frame.event === "disconnect") return;

      const sessionId = frame.sessionId;

      // Reset the inactivity timer on any activity — both received frames and
      // outbound frames confirmed by the TNC's Y response.  This prevents the
      // timer from firing during an active large-body transmission where the
      // remote station is silent but we are continuously sending.
      resetTimer(sessionId);

      // Tx frames are only used for the timer reset above; don't deliver them.
      if (frame.direction === "tx") return;

      // If another node (e.g. Send) holds the output claim for this session, skip.
      const claim = context.outputClaims.get(sessionId);
      if (claim && claim.node !== node) return;

      // If no claim exists yet (e.g. inbound connection), establish it now so that
      // this node's waitFor config is applied during delivery.
      if (!claim) {
        context.outputClaims.set(sessionId, { node, waitFor: parseWaitFor(config.waitFor) });
        context.lifecycleClaims.set(sessionId, node);
      }

      deliverFrame(context, node, sessionId, frame);
    };

    const onTimeoutSet = function (event) {
      if (event && event.sessionId && event.timeoutMs > 0) {
        startTimer(event.sessionId, event.timeoutMs);
      }
    };

    context.bus.on("conn-lifecycle", onLifecycle);
    context.bus.on("conn-data", onData);
    context.bus.on("conn-timeout-set", onTimeoutSet);

    node.on("input", function (msg, send, done) {
      const localSend = send || function (m) { node.send(m); };
      const localDone = done || function () {};

      if (context.state !== "connected") {
        localSend([errorEnvelope("CLIENT_NOT_CONNECTED", "AGWPE Client is not open", { instanceId: context.instanceId }), null]);
        localDone();
        return;
      }

      const destination = msg.destination || config.destination;
      let source = msg.source || config.source;
      if (!source && Array.isArray(context.callsigns) && context.callsigns.length > 0) {
        source = context.callsigns[0];
      }
      if (!destination || !source) {
        localSend([errorEnvelope("CONNECT_INVALID", "connect requires source and destination", { instanceId: context.instanceId }), null]);
        localDone();
        return;
      }

      let session;
      try {
        session = context.registry.create(context.instanceId, {
          source,
          destination,
          sessionId: msg.sessionId,
          mode: msg.mode || config.mode || "line",
          timeoutMs: (typeof msg.timeout === "number" && msg.timeout > 0) ? msg.timeout
            : (typeof config.timeout === "number" && config.timeout > 0) ? config.timeout : null
        });
      } catch (err) {
        localSend([errorEnvelope("SESSION_ID_CONFLICT", "Session already exists", { instanceId: context.instanceId }), null]);
        localDone();
        return;
      }

      // Register in the global session index so Send nodes can find the correct
      // agwpe-client instance from just a sessionId, without needing config.client.
      store.indexSession(session.sessionId, context.instanceId);

      // Claim output for the new session; this node receives inbound data.
      // msg.waitFor takes precedence over the node config (allows per-connection override).
      context.outputClaims.set(session.sessionId, { node, waitFor: parseWaitFor(msg.waitFor || config.waitFor) });
      // Claim lifecycle output (port 1) — never transferred to send nodes.
      context.lifecycleClaims.set(session.sessionId, node);

      const via = normalizeViaCallsigns(msg.via !== undefined ? msg.via : config.via);

      context.bus.emit("conn-data", {
        event: "connect",
        direction: "tx",
        instanceId: context.instanceId,
        sessionId: session.sessionId,
        source,
        destination,
        via
      });
      pendingConnections.add(session.sessionId);
      localSend([okEnvelope({ instanceId: context.instanceId, event: "connecting", sessionId: session.sessionId, source, destination, via }), null]);
      localDone();
    });

    node.on("close", function (removed, done) {
      pendingConnections.clear();
      context.bus.off("conn-lifecycle", onLifecycle);
      context.bus.off("conn-data", onData);
      context.bus.off("conn-timeout-set", onTimeoutSet);
      // Only cancel timers that this node instance started.
      context.sessionTimers.forEach(function (entry, sessionId) {
        if (entry.nodeId === node.id) {
          clearTimeout(entry.t);
          context.sessionTimers.delete(sessionId);
        }
      });
      done();
    });
  }

  RED.nodes.registerType("connect", ConnectNode);
};

