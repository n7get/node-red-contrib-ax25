"use strict";

const { okEnvelope, errorEnvelope } = require("../lib/message-utils");

function toByte(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 255) {
    throw new Error("RAW_FRAME_INVALID_BYTE");
  }
  return n;
}

function isBufferJsonObject(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "Buffer" &&
    Array.isArray(value.data)
  );
}

function parseHexString(input) {
  const cleaned = String(input || "")
    .trim()
    .replace(/0x/gi, "")
    .replace(/[\s,]+/g, "");

  if (!cleaned) {
    throw new Error("RAW_FRAME_EMPTY");
  }
  if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length % 2 !== 0) {
    throw new Error("RAW_FRAME_INVALID_HEX");
  }

  return Buffer.from(cleaned, "hex");
}

function coercePayloadToBuffer(payload) {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }

  if (isBufferJsonObject(payload)) {
    return Buffer.from(payload.data.map(toByte));
  }

  if (payload instanceof Uint8Array) {
    return Buffer.from(payload);
  }

  if (Array.isArray(payload)) {
    return Buffer.from(payload.map(toByte));
  }

  if (typeof payload === "string") {
    return parseHexString(payload);
  }

  throw new Error("RAW_FRAME_INVALID");
}

function getRawFrameInput(msg) {
  const direct = msg ? msg.payload : undefined;
  if (
    direct &&
    typeof direct === "object" &&
    !Buffer.isBuffer(direct) &&
    !Array.isArray(direct) &&
    !(direct instanceof Uint8Array) &&
    !isBufferJsonObject(direct) &&
    Object.prototype.hasOwnProperty.call(direct, "payload")
  ) {
    // Accept nested envelopes (for example: msg.payload = <encode output message>)
    return direct.payload;
  }
  return direct;
}

function resolveAgwpePort(msg, node) {
  const msgPort = msg ? msg.agwpePort : undefined;
  const msgFlag = msg ? msg.flag : undefined; // backward-compatible alias
  const configuredPort = node.agwpePort;
  const selected = msgPort !== undefined
    ? msgPort
    : (msgFlag !== undefined ? msgFlag : configuredPort);
  return toByte(selected === undefined || selected === null || selected === "" ? 0 : selected);
}

module.exports = function (RED) {
  function RawOutNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.agwpePort = config.agwpePort !== undefined ? config.agwpePort : config.flag;

    const cfg = RED.nodes.getNode(config.client);
    const context = cfg ? cfg.instance : null;

    node.on("input", function (msg, send, done) {
      const localSend = send || function (m) {
        node.send(m);
      };
      const localDone = done || function () {};

      if (!context) {
        localSend(errorEnvelope("CLIENT_NOT_FOUND", "AGWPE Client instance not found"));
        localDone();
        return;
      }

      if (!context.rawEnabled) {
        localSend(errorEnvelope("RAW_MODE_DISABLED", "Raw mode is disabled"));
        localDone();
        return;
      }

      let rawPayload;
      let agwpePort;
      try {
        rawPayload = coercePayloadToBuffer(getRawFrameInput(msg));
        agwpePort = resolveAgwpePort(msg, node);
      } catch (error) {
        localSend(
          errorEnvelope(
            "RAW_FRAME_INVALID",
            "Raw frame payload/agwpePort is invalid; payload must be Buffer, byte array, Uint8Array, hex string, or encode envelope"
          )
        );
        localDone();
        return;
      }

      context.bus.emit("raw-data", {
        instanceId: context.instanceId,
        payload: rawPayload,
        agwpePort,
        direction: "tx"
      });
      localSend(okEnvelope({ instanceId: context.instanceId, event: "raw-sent" }));
      localDone();
    });
  }

  RED.nodes.registerType("raw-out", RawOutNode);
};
