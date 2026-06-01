"use strict";

const codec = require("../lib/ax25-codec");
const { okEnvelope, errorEnvelope } = require("../lib/message-utils");

module.exports = function (RED) {
  function DecodeNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.payloadOutput = config.payloadOutput === "buffer" ? "buffer" : "string";

    function normalizeAgwpePort(value) {
      if (Buffer.isBuffer(value)) {
        return value.length > 0 ? value.readUInt8(0) : 0;
      }
      const numeric = Number(value);
      if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 255) {
        return numeric;
      }
      return 0;
    }

    node.on("input", function (msg, send, done) {
      const localSend = send || function (m) {
        node.send(m);
      };
      const localDone = done || function () {};

      if (!Buffer.isBuffer(msg.payload)) {
        localSend(errorEnvelope("DECODE_INPUT_INVALID", "payload must be Buffer"));
        localDone();
        return;
      }

      try {
        const parsed = codec.decode(msg.payload);
        const rawPort = msg.agwpePort !== undefined
          ? msg.agwpePort
          : (msg.agwpePrefix !== undefined ? msg.agwpePrefix : 0);
        const out = Object.assign(
          { agwpePort: normalizeAgwpePort(rawPort) },
          parsed
        );
        if (node.payloadOutput === "string" && Buffer.isBuffer(out.payload)) {
          out.payload = out.payload.toString("utf8");
        }
        localSend(okEnvelope(out));
      } catch (error) {
        localSend(errorEnvelope("DECODE_FAILED", error.message));
      }
      localDone();
    });
  }

  RED.nodes.registerType("decode", DecodeNode);
};
