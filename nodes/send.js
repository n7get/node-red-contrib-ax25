"use strict";

const { splitPayload } = require("../lib/frame-segmentation");
const { okEnvelope, errorEnvelope, makeMessageId } = require("../lib/message-utils");
const store = require("../lib/runtime-store");

// Maximum number of unacknowledged I-frames the TNC may hold before we pause.
// Matches the standard AX.25 modulo-8 window.
const MAX_OUTSTANDING = 7;

// How long to wait (ms) before re-querying the TNC when its buffer is full.
const Y_RETRY_DELAY_MS = 200;

// How long to wait (ms) for a Y response before giving up and sending anyway.
const Y_RESPONSE_TIMEOUT_MS = 2000;

function parseWaitFor(pattern) {
  if (!pattern || typeof pattern !== "string" || pattern.trim() === "") return null;
  try {
    return new RegExp(pattern);
  } catch (e) {
    return null;
  }
}

function normalizeSend(node, send) {
  return send || function (msg) {
    node.send(msg);
  };
}

// Mirror of the helper in connect.js; shared logic for inbound frame delivery.
function ensureConnBuffers(context) {
  if (!context.outputClaims) context.outputClaims = new Map();
  if (!context.lineBuffers) context.lineBuffers = new Map();
  if (!context.waitForBuffers) context.waitForBuffers = new Map();
}

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

  const prev = context.lineBuffers.get(sessionId) || "";
  const combined = prev + frame.payload.toString();
  const lines = combined.split(/\r\n|\r/);
  context.lineBuffers.set(sessionId, lines.pop());

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

/**
 * Emit a single data chunk onto the instance bus after confirming the TNC has
 * room for it.  Sends a 'y' query, waits for the 'Y' response and, if the TNC
 * reports fewer than MAX_OUTSTANDING pending frames, emits the 'conn-data'
 * event.  If the TNC is full the query is retried after Y_RETRY_DELAY_MS.
 * If no 'Y' response arrives within Y_RESPONSE_TIMEOUT_MS the chunk is sent
 * unconditionally so a non-responsive TNC does not stall the node forever.
 *
 * @param {object}   ctx         - Instance context from runtime-store.
 * @param {string}   source      - Our callsign.
 * @param {string}   destination - Remote callsign.
 * @param {object}   chunkEvent  - The full conn-data event payload to emit.
 * @param {Function} callback    - Called with no arguments when the chunk has
 *                                 been emitted (or the timeout fires).
 */
function sendChunkWithFlowControl(ctx, source, destination, chunkEvent, callback) {
  const normSource = (source || "").toUpperCase();
  const normDest   = (destination || "").toUpperCase();

  function attempt() {
    let settled = false;
    let retryTimer = null;

    const responseTimeout = setTimeout(function () {
      if (settled) return;
      settled = true;
      ctx.bus.off("conn-y-response", onYResponse);
      // No response from TNC — send without flow control.
      ctx.bus.emit("conn-data", chunkEvent);
      callback();
    }, Y_RESPONSE_TIMEOUT_MS);

    function onYResponse(response) {
      const rSrc  = (response.source      || "").toUpperCase();
      const rDest = (response.destination || "").toUpperCase();
      if (rSrc !== normSource || rDest !== normDest) return;

      if (settled) return;
      settled = true;
      ctx.bus.off("conn-y-response", onYResponse);
      clearTimeout(responseTimeout);

      if (response.outstanding >= MAX_OUTSTANDING) {
        // TNC buffer full — back off and retry.
        retryTimer = setTimeout(attempt, Y_RETRY_DELAY_MS);
        return;
      }

      ctx.bus.emit("conn-data", chunkEvent);
      callback();
    }

    ctx.bus.on("conn-y-response", onYResponse);
    ctx.bus.emit("conn-y-query", {
      instanceId: ctx.instanceId,
      source,
      destination,
      direction: "tx"
    });
  }

  attempt();
}

/**
 * Send all chunks for one payload item sequentially through Y-based flow
 * control.  Calls callback(null) when all chunks have been queued on the bus.
 */
function sendChunksWithFlowControl(ctx, source, destination, sessionId, messageId, chunks, callback) {
  let index = 0;

  function nextChunk() {
    if (index >= chunks.length) {
      callback(null);
      return;
    }

    const chunkIndex = index;
    const chunk      = chunks[index++];
    const chunkEvent = {
      instanceId: ctx.instanceId,
      sessionId,
      messageId,
      chunkIndex,
      chunkCount: chunks.length,
      direction:  "tx",
      payload:    chunk,
      source,
      destination
    };

    sendChunkWithFlowControl(ctx, source, destination, chunkEvent, nextChunk);
  }

  nextChunk();
}

module.exports = function (RED) {
  function SendNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    // config.client is no longer required for routing. The agwpe-client instance is
    // derived at runtime from the sessionId via the global session index, so a Send
    // node works automatically with whatever agwpe-client the Connect node used.
    node.status({});

    // Inbound data handler: fires for all instances via the global bus.
    // Only processes frames for sessions where this node holds the output claim.
    const onData = function (frame) {
      if (frame.direction === "tx") return;
      if (frame.event === "connect" || frame.event === "disconnect") return;

      const sessionId = frame.sessionId;
      // frame.instanceId is set by all real bus emissions; fall back to the session
      // index for test events that omit it.
      const iid = frame.instanceId || store.instanceIdForSession(sessionId);
      if (!iid) return;

      const context = store.getInstance(iid);
      if (!context) return;

      ensureConnBuffers(context);
      const claim = context.outputClaims.get(sessionId);
      if (!claim || claim.node !== node) return;

      deliverFrame(context, node, sessionId, frame);
    };

    store.globalBus.on("conn-data", onData);

    node.on("input", function (msg, send, done) {
      const localSend = normalizeSend(node, send);
      const localDone = done || function () {};

      const iid = store.instanceIdForSession(msg.sessionId);
      const ctx = iid ? store.getInstance(iid) : null;
      const session = ctx ? ctx.registry.get(ctx.instanceId, msg.sessionId) : null;
      if (!session) {
        localSend([errorEnvelope("SESSION_NOT_FOUND", "Session not found", { sessionId: msg.sessionId }), null]);
        localDone();
        return;
      }
      if (session.state !== "connected") {
        localSend([errorEnvelope("SESSION_NOT_CONNECTED", "Session is not connected", { sessionId: msg.sessionId }), null]);
        localDone();
        return;
      }
      // Allow array payloads: each item is sent as a separate D frame.
      const payloadItems = Array.isArray(msg.payload) ? msg.payload : [msg.payload];
      for (let i = 0; i < payloadItems.length; i++) {
        if (typeof payloadItems[i] !== "string" && !Buffer.isBuffer(payloadItems[i])) {
          localSend([errorEnvelope("PAYLOAD_INVALID", "payload items must be string or Buffer", { sessionId: msg.sessionId }), null]);
          localDone();
          return;
        }
      }

      ensureConnBuffers(ctx);
      // Claim output for this session; flush any pending waitFor buffer if claim is changing.
      const currentClaim = ctx.outputClaims.get(msg.sessionId);
      if (currentClaim && currentClaim.node !== node) {
        const pendingBuf = ctx.waitForBuffers.get(msg.sessionId);
        if (pendingBuf && pendingBuf.length > 0) {
          currentClaim.node.send([null, okEnvelope({
            instanceId: ctx.instanceId,
            sessionId: msg.sessionId,
            event: "data",
            payload: pendingBuf
          })]);
          ctx.waitForBuffers.delete(msg.sessionId);
        }
      }
      ctx.outputClaims.set(msg.sessionId, { node, waitFor: parseWaitFor(msg.waitFor || config.waitFor) });

      const resolvedTimeout = (typeof msg.timeout === "number" && msg.timeout > 0) ? msg.timeout
        : (typeof config.timeout === "number" && config.timeout > 0) ? config.timeout : null;
      if (resolvedTimeout) {
        ctx.registry.update(ctx.instanceId, msg.sessionId, { timeoutMs: resolvedTimeout });
        ctx.bus.emit("conn-timeout-set", { sessionId: msg.sessionId, timeoutMs: resolvedTimeout });
      }

      const sessionMode = session.mode || "binary";
      const source      = session.source || session.sourceCallsign;
      const destination = session.destination || session.destinationCallsign;

      // Build all (item, chunks) pairs up front so we know totalChunkCount before
      // any async work begins, and can report the correct value in the 'sent' event.
      const itemJobs = payloadItems.map(function (item) {
        let sendItem = item;
        if (sessionMode === "line") {
          const itemStr = Buffer.isBuffer(sendItem) ? sendItem.toString() : String(sendItem);
          sendItem = itemStr + "\r";
        }
        return { messageId: makeMessageId("conn"), chunks: splitPayload(sendItem, 256) };
      });

      const totalChunkCount = itemJobs.reduce(function (acc, j) { return acc + j.chunks.length; }, 0);
      const lastMessageId   = itemJobs.length > 0 ? itemJobs[itemJobs.length - 1].messageId : undefined;

      // Send payload items sequentially, each with Y-based per-chunk flow control.
      let jobIndex = 0;
      function nextJob() {
        if (jobIndex >= itemJobs.length) {
          localSend([
            okEnvelope({
              instanceId: ctx.instanceId,
              event: "sent",
              sessionId: msg.sessionId,
              messageId: lastMessageId,
              chunkCount: totalChunkCount
            }),
            null
          ]);
          localDone();
          return;
        }

        const job = itemJobs[jobIndex++];
        sendChunksWithFlowControl(ctx, source, destination, msg.sessionId, job.messageId, job.chunks, function () {
          nextJob();
        });
      }

      nextJob();
    });

    node.on("close", function (removed, done) {
      store.globalBus.off("conn-data", onData);
      // Release output claims held by this node across all instances.
      store.getAllInstances().forEach(function (context) {
        if (context.outputClaims) {
          context.outputClaims.forEach(function (claim, sessionId) {
            if (claim.node === node) {
              context.outputClaims.delete(sessionId);
            }
          });
        }
      });
      done();
    });
  }

  RED.nodes.registerType("send", SendNode);
};
