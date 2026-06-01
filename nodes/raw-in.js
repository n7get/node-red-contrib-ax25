"use strict";

const codec = require("../lib/ax25-codec");
const { okEnvelope } = require("../lib/message-utils");

module.exports = function (RED) {
  function RawInNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const cfg = RED.nodes.getNode(config.client);
    const context = cfg ? cfg.instance : null;
    if (!context) {
      node.status({ fill: "red", shape: "ring", text: "client missing" });
      return;
    }

    const onRawData = function (frame) {
      if (!context.rawEnabled) {
        return;
      }

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

      // Strip leading AGWPE K-frame pad byte (0x00) that precedes the AX.25
      // address chain in some AGWPE implementations.  Payload emitted to
      // downstream nodes is the raw AX.25 wire frame only.
      let rawPayload = frame.payload;
      let agwpePort = normalizeAgwpePort(frame.agwpePort);
      if (rawPayload.length > 1 && rawPayload[0] === 0x00 && rawPayload[1] >= 0x60) {
        agwpePort = rawPayload.readUInt8(0);
        rawPayload = rawPayload.subarray(1);
      }

      node.send(
        okEnvelope({
          instanceId: context.instanceId,
          event: "raw",
          payload: rawPayload,
          agwpePort,
          source: frame.source,
          destination: frame.destination,
          via: (function () {
            try {
              return codec.decodeWireAx25(rawPayload).via || [];
            } catch (_) {
              return [];
            }
          }())
        })
      );
    };

    context.bus.on("raw-data", onRawData);

    node.on("close", function (removed, done) {
      context.bus.off("raw-data", onRawData);
      done();
    });
  }

  RED.nodes.registerType("raw-in", RawInNode);
};
