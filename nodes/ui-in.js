"use strict";

const codec = require("../lib/ax25-codec");
const { okEnvelope } = require("../lib/message-utils");

module.exports = function (RED) {
  function UiInNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.payloadOutput = config.payloadOutput === "buffer" ? "buffer" : "string";

    const cfg = RED.nodes.getNode(config.client);
    const context = cfg ? cfg.instance : null;
    if (!context) {
      node.status({ fill: "red", shape: "ring", text: "client missing" });
      return;
    }

    const onRawData = function (frame) {
      if (!context.rawEnabled || !frame || !Buffer.isBuffer(frame.payload)) {
        return;
      }

      // Some AGWPE implementations prepend a one-byte port prefix to K payloads.
      const rawPayload =
        frame.payload.length > 1 && frame.payload[0] === 0x00 && frame.payload[1] >= 0x60
          ? frame.payload.subarray(1)
          : frame.payload;

      let decoded;
      try {
        decoded = codec.decodeWireAx25(rawPayload);
      } catch (_error) {
        return;
      }

      // UI frame control field: 0x03 with optional P/F bit (0x13).
      if ((decoded.control & 0xef) !== 0x03) {
        return;
      }

      const payload =
        node.payloadOutput === "string" && Buffer.isBuffer(decoded.payload)
          ? decoded.payload.toString("utf8")
          : decoded.payload;

      node.send(
        okEnvelope({
          instanceId: context.instanceId,
          event: "ui",
          source: decoded.source,
          destination: decoded.destination,
          via: decoded.via,
          payload
        })
      );
    };

    context.bus.on("raw-data", onRawData);

    node.on("close", function (removed, done) {
      context.bus.off("raw-data", onRawData);
      done();
    });
  }

  RED.nodes.registerType("ui-in", UiInNode);
};
