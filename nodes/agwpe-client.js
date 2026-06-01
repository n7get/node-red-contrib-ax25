"use strict";

const Transport = require("../lib/agwpe-client-transport");
const store = require("../lib/runtime-store");
const { makeMessageId } = require("../lib/message-utils");
const {
  makeRegistrationFrame,
  makeConnectFrame,
  makeViaConnectFrame,
  makeDisconnectFrame,
  makeDataFrame,
  makeUiFrame,
  makeRawFrame,
  makeMonitorToggleFrame,
  makeRawToggleFrame,
  makeOutstandingQueryFrame
} = require("../lib/agwpe-frame-builder");
const { decodeWireAx25 } = require("../lib/ax25-codec");

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8000;
const DEFAULT_RECONNECT_DELAY = 5000;

function normalizeCallsigns(callsigns) {
  if (typeof callsigns === "string") {
    return [callsigns];
  }
  if (Array.isArray(callsigns)) {
    return callsigns.slice();
  }
  return [];
}

function makeAgwpeRegistrationFrame(callsign) {
  return makeRegistrationFrame(callsign);
}

function decodeAgwpeCallsign(frame, offset) {
  const raw = frame.subarray(offset, offset + 10);
  const nul = raw.indexOf(0x00);
  const end = nul >= 0 ? nul : raw.length;
  return raw.subarray(0, end).toString("ascii").trim();
}

function decodeInboundAgwpeFrame(instanceId, frame) {
  const dataKind = String.fromCharCode(frame.readUInt8(4));
  const source = decodeAgwpeCallsign(frame, 8);
  const destination = decodeAgwpeCallsign(frame, 18);
  const payloadLen = frame.readUInt32LE(28);
  const payload = frame.subarray(36, 36 + payloadLen);

  // AGWPE sends incoming unproto/UI traffic as 'U' frames.
  if (dataKind === "U") {
    return {
      kind: "ui",
      direction: "rx",
      instanceId,
      source,
      destination,
      payload,
      messageId: makeMessageId("ui"),
      chunkIndex: 0,
      chunkCount: 1
    };
  }

  // AGWPE sends a 'C' frame to confirm an inbound or outbound connection is established.
  if (dataKind === "C") {
    return {
      kind: "connected",
      direction: "rx",
      instanceId,
      source,
      destination,
      payload
    };
  }

  // AGWPE sends a 'd' frame when a connected session is terminated (remote or TNC-initiated).
  if (dataKind === "d") {
    return {
      kind: "disconnected",
      direction: "rx",
      instanceId,
      source,
      destination,
      payload
    };
  }

  // AGWPE sends incoming raw AX.25 frames as 'K' frames.
  // Some AGWPE servers (e.g. Kantronics KA-Node) never send 'C' (connected) or 'D' (data)
  // frames — all connected-session traffic arrives inside 'K' frames instead. Decode the
  // embedded AX.25 to recover connection and data events so session routing still applies.
  if (dataKind === "K") {
    try {
      const ax25 = decodeWireAx25(payload);
      if (ax25.frameType === "I") {
        // AX.25 I-frame: connected data from an established session.
        // _kFrameOrigin marks this as derived from a raw K-frame so
        // parseInboundAgwpeStream can suppress it when a D-frame for the
        // same session also appears in the same TCP segment.
        return {
          kind: "connected-data",
          direction: "rx",
          instanceId,
          source: ax25.source,
          destination: ax25.destination,
          via: ax25.via || [],
          payload: ax25.payload,
          _kFrameOrigin: true,
          _ax25Control: ax25.control
        };
      }
      // UA (0x63 with F=0 / 0x73 with F=1): remote station accepted our SABM.
      if (ax25.frameType === "U" && (ax25.control & 0xEF) === 0x63) {
        return {
          kind: "connected",
          direction: "rx",
          instanceId,
          source: ax25.source,
          destination: ax25.destination,
          payload
        };
      }
    } catch (_) {
      // Not a decodable AX.25 frame; deliver as raw.
    }
    return {
      kind: "raw",
      direction: "rx",
      instanceId,
      source,
      destination,
      payload,
      dataKind
    };
  }

  // 'Y' response: the TNC reports the number of outstanding (unacknowledged) I-frames
  // for the callsign pair identified by source/destination.  The outstanding count is
  // encoded in the DataLen field (bytes 28-31); there is no payload body.
  if (dataKind === "Y") {
    return {
      kind: "outstanding-response",
      direction: "rx",
      instanceId,
      source,
      destination,
      outstanding: payloadLen
    };
  }

  // AGWPE sends connected session data as 'D' frames (standard-compliant TNCs).
  if (dataKind === "D") {
    return {
      kind: "connected-data",
      direction: "rx",
      instanceId,
      source,
      destination,
      payload
    };
  }

  // Ignore other frame types (connection lifecycle, monitor, etc.)
  return null;
}

function parseInboundAgwpeStream(context, chunk) {
  context._rxBuffer = Buffer.concat([context._rxBuffer || Buffer.alloc(0), chunk]);
  const parsed = [];

  while (context._rxBuffer.length >= 36) {
    // AGWPE 'Y' (0x59) frames carry the outstanding-frame count in the DataLen
    // field but have no payload body.  Treat their frame size as exactly 36 bytes
    // so the stream parser does not stall waiting for phantom payload bytes.
    const frameKind = context._rxBuffer.readUInt8(4);
    const dataLen = frameKind === 0x59 ? 0 : context._rxBuffer.readUInt32LE(28);
    const totalLen = 36 + dataLen;
    if (context._rxBuffer.length < totalLen) {
      break;
    }

    const one = context._rxBuffer.subarray(0, totalLen);
    context._rxBuffer = context._rxBuffer.subarray(totalLen);
    const decoded = decodeInboundAgwpeFrame(context.instanceId, one);
    if (decoded) {
      parsed.push(decoded);
    }
  }

  // Some AGWPE servers (e.g. soundmodem) emit both a raw K-frame (embedded AX.25
  // I-frame) and a parsed D-frame for the same connected-session data. Delivering
  // both causes the flow to receive each message twice.
  //
  // Two complementary dedup strategies:
  //
  //   Same-batch  — K-frame and D-frame arrive in the same TCP segment: suppress
  //   the K-frame immediately; no persistent state needed.
  //
  //   Cross-segment — K-frame and D-frame arrive in separate TCP segments (common
  //   in practice). context._kFrameDedup tracks per (source>destination) state:
  //     pendingPayload  payload of the last delivered K-frame I-frame
  //     dFrameMode      once true, all future K-frame I-frames for this pair are
  //                     suppressed (D-frames are then the authoritative source)
  if (!context._kFrameDedup) {
    context._kFrameDedup = new Map();
  }

  // Pass 1: collect source>destination keys for D-frames in this batch (same-batch dedup).
  const dFramePairs = new Set();
  for (const f of parsed) {
    if (f.kind === "connected-data" && !f._kFrameOrigin) {
      dFramePairs.add(
        (f.source || "").toUpperCase() + ">" + (f.destination || "").toUpperCase()
      );
    }
  }

  // Pass 2: apply dedup rules and build result.
  const result = [];
  for (const f of parsed) {
    if (f.kind === "connected-data") {
      const srcKey = (f.source || "").toUpperCase();
      const dstKey = (f.destination || "").toUpperCase();
      const pairKey = srcKey + ">" + dstKey;

      if (f._kFrameOrigin) {
        // Same-batch: a D-frame for this pair is in the same batch — suppress K-frame.
        if (dFramePairs.has(pairKey)) {
          delete f._kFrameOrigin;
          continue;
        }
        // Cross-segment: check session-level dFrameMode.
        const dedup = context._kFrameDedup.get(pairKey) || { dFrameMode: false, pendingPayload: null };
        if (dedup.dFrameMode) {
          // Session has confirmed it uses D-frames; suppress K-frame I-frames.
          delete f._kFrameOrigin;
          continue;
        }
        // K-K digipeater dedup: suppress the digipeated copy of a K-I frame we
        // already delivered (same AX.25 N(S) sequence number from the same pair
        // within a 10-second window).
        if (f._ax25Control !== undefined) {
          const seq = (f._ax25Control >> 1) & 0x07;
          if (dedup.lastKSeq === seq && typeof dedup.lastKTime === "number" &&
              (Date.now() - dedup.lastKTime) < 10000) {
            delete f._kFrameOrigin;
            delete f._ax25Control;
            continue;
          }
          context._kFrameDedup.set(pairKey, { dFrameMode: false, pendingPayload: f.payload, lastKSeq: seq, lastKTime: Date.now() });
        } else {
          // Deliver this K-frame and stash its payload for cross-segment dedup.
          context._kFrameDedup.set(pairKey, { dFrameMode: false, pendingPayload: f.payload });
        }
      } else {
        // D-frame: check for a pending K-frame payload to suppress.
        const dedup = context._kFrameDedup.get(pairKey) || { dFrameMode: false, pendingPayload: null };
        const pending = dedup.pendingPayload;
        if (pending && Buffer.isBuffer(pending) && pending.equals(f.payload)) {
          // K-frame already delivered this payload cross-segment; suppress D-frame.
          context._kFrameDedup.set(pairKey, { dFrameMode: true, pendingPayload: null });
          continue;
        }
        // D-frame with no matching pending K-frame: deliver and record dFrameMode.
        context._kFrameDedup.set(pairKey, { dFrameMode: true, pendingPayload: null });
      }
    }

    delete f._kFrameOrigin;
    delete f._ax25Control;
    result.push(f);
  }

  return result;
}

function createRouterHandlers(context) {
  function routeInboundConnData(source, destination, payload, via) {
    // Match received frame to a registered connected session.
    // In a received frame: AX.25 destination = our callsign, AX.25 source = remote callsign.
    const sessions = context.registry.list(context.instanceId);
    const session = sessions.find(function (s) {
      return s.state === "connected" &&
        s.sourceCallsign.toUpperCase() === destination.toUpperCase() &&
        s.destinationCallsign.toUpperCase() === source.toUpperCase();
    });
    if (!session) return;
    context.bus.emit("conn-data", {
      direction: "rx",
      instanceId: context.instanceId,
      sessionId: session.sessionId,
      payload,
      source,
      destination,
      via: via || []
    });
  }

  return {
    onUi: function (frame) {
      context.bus.emit("ui-data", frame);
    },
    onConnected: function (frame) {
      // Find the pending session this C frame confirms. Accept both callsign orientations:
      // some TNCs reply with source=remote/destination=us, others echo back source=us/destination=remote.
      const sessions = context.registry.list(context.instanceId);
      const session = sessions.find(function (s) {
        if (s.state !== "connecting") return false;
        const a = s.sourceCallsign.toUpperCase();
        const b = s.destinationCallsign.toUpperCase();
        const x = frame.source.toUpperCase();
        const y = frame.destination.toUpperCase();
        return (a === y && b === x) || (a === x && b === y);
      });
      if (!session) return;
      // Resolve which callsign is ours (sourceCallsign) regardless of frame orientation.
      const ourCallsign = session.sourceCallsign;
      const remoteCallsign = session.destinationCallsign;
      context.registry.update(context.instanceId, session.sessionId, { state: "connected" });
      context.bus.emit("conn-lifecycle", {
        event: "connected",
        instanceId: context.instanceId,
        sessionId: session.sessionId,
        source: ourCallsign,
        destination: remoteCallsign,
        called: remoteCallsign
      });
    },
    onDisconnected: function (frame) {
      // Find the session this d frame terminates. Match either direction for robustness.
      const sessions = context.registry.list(context.instanceId);
      const session = sessions.find(function (s) {
        const a = s.sourceCallsign.toUpperCase();
        const b = s.destinationCallsign.toUpperCase();
        const x = frame.source.toUpperCase();
        const y = frame.destination.toUpperCase();
        return (a === y && b === x) || (a === x && b === y);
      });
      if (!session) return;
      context.registry.remove(context.instanceId, session.sessionId);
      // Clear K-frame dedup state so a future reconnect starts fresh.
      if (context._kFrameDedup) {
        const dedupKey =
          session.destinationCallsign.toUpperCase() + ">" + session.sourceCallsign.toUpperCase();
        context._kFrameDedup.delete(dedupKey);
      }
      context.bus.emit("conn-lifecycle", {
        event: "disconnected",
        instanceId: context.instanceId,
        sessionId: session.sessionId,
        source: session.sourceCallsign,
        destination: session.destinationCallsign
      });
    },
    onConnectedBySession: function (sessionId, frame) {
      context.bus.emit("conn-data", frame);
    },
    onConnectedData: function (frame) {
      routeInboundConnData(frame.source, frame.destination, frame.payload, frame.via);
    },
    onMonitor: function (frame) {
      context.bus.emit("monitor-data", frame);
    },
    onRaw: function (frame) {
      context.bus.emit("raw-data", frame);
    },
    onOutstandingResponse: function (frame) {
      context.bus.emit("conn-y-response", frame);
    },
    onLifecycle: function (frame) {
      context.bus.emit("conn-lifecycle", frame);
    }
  };
}

function sendCallsignRegistrations(node, context) {
  if (!context.transport || typeof context.transport.sendFrame !== "function") {
    return;
  }

  context.callsigns.forEach(function (callsign) {
    const frame = makeAgwpeRegistrationFrame(callsign);
    context.transport.sendFrame(frame, function (error) {
      if (error) {
        node.warn(`AGWPE callsign registration failed for ${callsign}: ${error.message}`);
      }
    });
  });
}

function syncMonitorMode(node, context) {
  if (!context.transport || typeof context.transport.sendFrame !== "function") {
    return;
  }

  // AGWPE 'm' is a toggle command. Keep a local wire-state mirror and only send when needed.
  const desiredEnabled = Boolean(context.monitorEnabled);
  const currentlyEnabled = Boolean(context.monitorWireEnabled);
  if (desiredEnabled === currentlyEnabled) {
    return;
  }

  context.transport.sendFrame(makeMonitorToggleFrame(), function (error) {
    if (error) {
      node.warn(`AGWPE monitor toggle TX failed: ${error.message}`);
      return;
    }
    context.monitorWireEnabled = desiredEnabled;
  });
}

function syncRawMode(node, context) {
  if (!context.transport || typeof context.transport.sendFrame !== "function") {
    return;
  }

  // AGWPE 'k' is a toggle command. Keep a local wire-state mirror and only send when needed.
  const desiredEnabled = Boolean(context.rawEnabled);
  const currentlyEnabled = Boolean(context.rawWireEnabled);
  if (desiredEnabled === currentlyEnabled) {
    return;
  }

  context.transport.sendFrame(makeRawToggleFrame(), function (error) {
    if (error) {
      node.warn(`AGWPE raw toggle TX failed: ${error.message}`);
      return;
    }
    context.rawWireEnabled = desiredEnabled;
  });
}

function bindTransportBridge(node, context) {
  if (context.transportBridgeBound) {
    return;
  }

  function sendWireFrame(wireFrame, label) {
    if (!context.transport || typeof context.transport.sendFrame !== "function") {
      return;
    }
    context.transport.sendFrame(wireFrame, function (error) {
      if (error) {
        node.warn(`AGWPE ${label} TX failed: ${error.message}`);
      }
    });
  }

  context._onConnTx = function (frame) {
    if (!frame || frame.direction !== "tx") {
      return;
    }
    if (frame.event === "connect") {
      const viaPath = Array.isArray(frame.via) && frame.via.length > 0 ? frame.via : null;
      sendWireFrame(
        viaPath
          ? makeViaConnectFrame(frame.source, frame.destination, viaPath)
          : makeConnectFrame(frame.source, frame.destination),
        "conn-connect"
      );
    } else if (frame.event === "disconnect") {
      sendWireFrame(makeDisconnectFrame(frame.source, frame.destination), "conn-disconnect");
    } else {
      // data chunk
      const payload = Buffer.isBuffer(frame.payload)
        ? frame.payload
        : Buffer.from(frame.payload || "", "utf8");
      sendWireFrame(makeDataFrame(frame.source, frame.destination, payload), "conn-data");
    }
  };

  context._onUiTx = function (frame) {
    if (!frame || frame.direction !== "tx") {
      return;
    }
    const payload = Buffer.isBuffer(frame.payload)
      ? frame.payload
      : Buffer.from(frame.payload || "", "utf8");
    sendWireFrame(makeUiFrame(frame.source, frame.destination, payload), "ui-data");
  };

  context._onRawTx = function (frame) {
    if (!frame || frame.direction !== "tx") {
      return;
    }
    // Raw frames carry AX.25 wire bytes inside AGWPE 'K' frames.
    // Many AGWPE implementations include a leading 0x00 flag byte before
    // the AX.25 address chain for K payloads; preserve provided prefix or
    // prepend 0x00 by default for interoperability.
    const ax25Payload = Buffer.isBuffer(frame.payload)
      ? frame.payload
      : typeof frame.payload === "string"
        ? Buffer.from(frame.payload, "utf8")
        : null;
    if (!ax25Payload) {
      node.warn("AGWPE raw-data TX frame skipped: invalid payload");
      return;
    }

    const providedPort = frame.agwpePort !== undefined ? frame.agwpePort : frame.agwpePrefix;
    let portByte = null;
    if (Buffer.isBuffer(providedPort)) {
      portByte = providedPort.length > 0 ? providedPort.readUInt8(0) : 0;
    } else {
      const numeric = Number(providedPort);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 255) {
        portByte = numeric;
      }
    }

    const payload = portByte !== null
      ? Buffer.concat([Buffer.from([portByte]), ax25Payload])
      : ax25Payload[0] === 0x00
        ? ax25Payload
        : Buffer.concat([Buffer.from([0x00]), ax25Payload]);

    sendWireFrame(makeRawFrame(frame.source, frame.destination, payload), "raw-data");
  };

  context._onYQuery = function (frame) {
    // Only send a real 'y' query when the transport is a two-way EventEmitter that
    // can emit the TNC's 'Y' response back.  Plain-object test stubs and bare {}
    // transports have no .on(), so we reply immediately with outstanding=0 to keep
    // the send node's flow-control path synchronous in tests.
    if (!context.transport || typeof context.transport.on !== "function") {
      context.bus.emit("conn-y-response", {
        kind: "outstanding-response",
        direction: "rx",
        instanceId: context.instanceId,
        source: frame.source,
        destination: frame.destination,
        outstanding: 0
      });
      return;
    }
    sendWireFrame(makeOutstandingQueryFrame(frame.source, frame.destination), "conn-y-query");
  };

  context.bus.on("conn-data", context._onConnTx);
  context.bus.on("ui-data", context._onUiTx);
  context.bus.on("raw-data", context._onRawTx);
  context.bus.on("conn-y-query", context._onYQuery);
  context.transportBridgeBound = true;
}

function unbindTransportBridge(context) {
  if (!context.transportBridgeBound) {
    return;
  }

  if (context._onConnTx) {
    context.bus.off("conn-data", context._onConnTx);
  }
  if (context._onUiTx) {
    context.bus.off("ui-data", context._onUiTx);
  }
  if (context._onRawTx) {
    context.bus.off("raw-data", context._onRawTx);
  }
  if (context._onYQuery) {
    context.bus.off("conn-y-query", context._onYQuery);
  }

  context._onConnTx = null;
  context._onUiTx = null;
  context._onRawTx = null;
  context._onYQuery = null;
  context.transportBridgeBound = false;
}

function validateConfig(config) {
  if (!config.host) return "CONNECT_REQUIRES_HOST";
  if (!Number.isInteger(config.port)) return "CONNECT_REQUIRES_PORT";
  return null;
}

// Cancel all active session timers, emit synthetic 'disconnected' for every
// live session so consumer nodes can flush buffered data and release claims,
// then wipe all shared per-session state from context and the registry.
// Called whenever the transport drops unexpectedly (server crash or restart).
function cleanupActiveSessions(context) {
  if (context.sessionTimers) {
    context.sessionTimers.forEach(function (entry) {
      if (entry && entry.t) clearTimeout(entry.t);
    });
    context.sessionTimers.clear();
  }

  const sessions = context.registry.list(context.instanceId);
  sessions.forEach(function (session) {
    context.bus.emit("conn-lifecycle", {
      event: "disconnected",
      sessionId: session.sessionId,
      instanceId: context.instanceId,
      source: session.sourceCallsign,
      destination: session.destinationCallsign
    });
  });

  if (context.outputClaims) context.outputClaims.clear();
  if (context.lineBuffers) context.lineBuffers.clear();
  if (context.waitForBuffers) context.waitForBuffers.clear();
  if (context.lifecycleClaims) context.lifecycleClaims.clear();
  context.registry.clearInstance(context.instanceId);
}

function scheduleReconnect(node, context) {
  if (context._closing || !context.reconnect || context._testTransport) {
    return;
  }
  if (context._reconnectTimer) {
    return;
  }
  node.status({ fill: "yellow", shape: "ring", text: "reconnecting..." });
  context.bus.emit("conn-lifecycle", { event: "transport-reconnecting" });
  context._reconnectTimer = setTimeout(function () {
    context._reconnectTimer = null;
    context.transport = null;
    connectToTnc(node, context);
  }, context.reconnectDelay);
}

function connectToTnc(node, context) {
  unbindTransportBridge(context);
  context.router.unregisterInstance(context.instanceId);

  if (!context.host || !Number.isInteger(context.port)) {
    const err = validateConfig(context);
    node.status({ fill: "red", shape: "ring", text: "config error" });
    node.warn("agwpe-client: " + err);
    return;
  }

  context.monitorWireEnabled = false;
  context.rawWireEnabled = false;
  context.state = "connecting";
  node.status({ fill: "yellow", shape: "dot", text: "connecting" });
  context.bus.emit("conn-lifecycle", { event: "transport-connecting" });

  const transportLogger = typeof node.log === "function" ? node.log.bind(node) : undefined;
  context.transport = context._testTransport || new Transport({ logger: transportLogger });

  if (typeof context.transport.on === "function") {
    context.transport.on("error", function (error) {
      context.state = "failed";
      node.status({ fill: "red", shape: "dot", text: "failed" });
      context.bus.emit("conn-lifecycle", {
        event: "failed",
        errorCode: "TRANSPORT_ERROR",
        errorText: error.message
      });
      scheduleReconnect(node, context);
    });
    context.transport.on("closed", function () {
      context.state = "disconnected";
      cleanupActiveSessions(context);
      context.bus.emit("conn-lifecycle", { event: "transport-closed" });
      scheduleReconnect(node, context);
      if (!context._reconnectTimer) {
        node.status({ fill: "grey", shape: "ring", text: "disconnected" });
      }
    });
    context.transport.on("frame", function (data) {
      if (Buffer.isBuffer(data)) {
        parseInboundAgwpeStream(context, data).forEach(function (decodedFrame) {
          context.router.route(context.instanceId, decodedFrame);
        });
        return;
      }
      context.router.route(context.instanceId, data);
    });
  }

  bindTransportBridge(node, context);

  if (context._testTransport) {
    context.router.registerInstance(context.instanceId, createRouterHandlers(context));
    context.state = "connected";
    node.status({ fill: "green", shape: "dot", text: "connected" });
    context.bus.emit("conn-lifecycle", { event: "transport-connected" });
    sendCallsignRegistrations(node, context);
    syncMonitorMode(node, context);
    syncRawMode(node, context);
    return;
  }

  context.transport.open(context.host, context.port, function (error) {
    if (error) {
      context.state = "failed";
      node.status({ fill: "red", shape: "dot", text: "failed" });
      context.bus.emit("conn-lifecycle", {
        event: "failed",
        errorCode: "OPEN_FAILED",
        errorText: error.message
      });
      scheduleReconnect(node, context);
      return;
    }

    context.router.registerInstance(context.instanceId, createRouterHandlers(context));
    context.state = "connected";
    node.status({ fill: "green", shape: "dot", text: "connected" });
    context.bus.emit("conn-lifecycle", { event: "transport-connected" });
    sendCallsignRegistrations(node, context);
    syncMonitorMode(node, context);
    syncRawMode(node, context);
  });
}

module.exports = function (RED) {
  function AgwpeClientConfig(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    const logger = typeof node.log === "function" ? node.log.bind(node) : undefined;
    const context = store.createInstance(node.id, logger);
    context.instanceId = node.id;

    // Expose instance so consumer nodes can reach it via RED.nodes.getNode(id).instance
    node.instance = context;

    // Keep node reference on context for warn/status calls in transport helpers
    context.node = node;

    context.host = config.host != null ? config.host : DEFAULT_HOST;
    context.port = Number(config.port) || DEFAULT_PORT;
    context.monitorEnabled = Boolean(config.monitor);
    context.monitorWireEnabled = false;
    context.rawEnabled = Boolean(config.raw);
    context.rawWireEnabled = false;
    context.callsigns = normalizeCallsigns(config.callsigns);
    context.auth = (config.username && config.password)
      ? { username: config.username, password: config.password }
      : null;
    context.reconnect = config.reconnect !== false; // default true
    context.reconnectDelay = Number(config.reconnectDelay) || DEFAULT_RECONNECT_DELAY;
    context._testTransport = config._testTransport || null;
    context._closing = false;
    context._reconnectTimer = null;

    node.status({ fill: "grey", shape: "ring", text: "disconnected" });

    connectToTnc(node, context);

    node.on("close", function (removed, done) {
      context._closing = true;
      if (context._reconnectTimer) {
        clearTimeout(context._reconnectTimer);
        context._reconnectTimer = null;
      }
      context.router.unregisterInstance(context.instanceId);
      unbindTransportBridge(context);

      if (context.transport && typeof context.transport.close === "function") {
        context.transport.close(function () {
          store.removeInstance(node.id);
          done();
        });
        return;
      }
      store.removeInstance(node.id);
      done();
    });
  }

  RED.nodes.registerType("agwpe-client", AgwpeClientConfig);
};

module.exports._internal = { validateConfig };
