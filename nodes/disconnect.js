"use strict";

const { okEnvelope, errorEnvelope } = require("../lib/message-utils");
const store = require("../lib/runtime-store");

module.exports = function (RED) {
  function DisconnectNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.status({});

    node.on("input", function (msg, send, done) {
      const localSend = send || function (m) { node.send(m); };
      const localDone = done || function () {};

      const iid = store.instanceIdForSession(msg.sessionId);
      const ctx = iid ? store.getInstance(iid) : null;
      const session = ctx ? ctx.registry.get(ctx.instanceId, msg.sessionId) : null;
      if (!session) {
        localSend(errorEnvelope("SESSION_NOT_FOUND", "Session not found", { sessionId: msg.sessionId }));
        localDone();
        return;
      }

      ctx.registry.update(ctx.instanceId, msg.sessionId, { state: "disconnecting" });
      ctx.bus.emit("conn-data", {
        event: "disconnect",
        direction: "tx",
        instanceId: ctx.instanceId,
        sessionId: msg.sessionId,
        source: session.source || session.sourceCallsign,
        destination: session.destination || session.destinationCallsign
      });
      ctx.bus.emit("conn-lifecycle", {
        event: "disconnecting",
        instanceId: ctx.instanceId,
        sessionId: msg.sessionId
      });
      // Session removal and "disconnected" event fire when the TNC confirms with a d frame.
      localSend(okEnvelope({ instanceId: ctx.instanceId, event: "disconnecting", sessionId: msg.sessionId }));
      localDone();
    });
  }

  RED.nodes.registerType("disconnect", DisconnectNode);
};
