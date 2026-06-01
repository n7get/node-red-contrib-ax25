"use strict";

const codec = require("../lib/ax25-codec");
const { okEnvelope, errorEnvelope } = require("../lib/message-utils");

function splitCallsignList(value) {
  return String(value || "")
    .split(/[\s,]+/)
    .map(function (item) {
      return item.trim();
    })
    .filter(Boolean);
}

function normalizeViaInput(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "string") {
    return splitCallsignList(value);
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const expanded = [];
  value.forEach(function (entry) {
    if (typeof entry === "string") {
      splitCallsignList(entry).forEach(function (callsign) {
        expanded.push(callsign);
      });
      return;
    }

    if (entry && typeof entry === "object" && typeof entry.callsign === "string") {
      splitCallsignList(entry.callsign).forEach(function (callsign) {
        expanded.push({
          callsign,
          hasBeenRepeated: Boolean(entry.hasBeenRepeated)
        });
      });
      return;
    }

    expanded.push(entry);
  });

  return expanded;
}

function pickValue(msgValue, configValue) {
  return msgValue !== undefined ? msgValue : configValue;
}

function parseByte(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) {
    throw new Error("ENCODE_INVALID_BYTE");
  }
  return numeric;
}

function controlFromFrameType(frameType) {
  const type = String(frameType || "").trim().toUpperCase();
  if (!type) {
    return undefined;
  }
  if (type === "I") {
    return 0x00;
  }
  if (type === "S") {
    return 0x01;
  }
  if (type === "U") {
    return 0x03;
  }
  throw new Error("ENCODE_INVALID_FRAME_TYPE");
}

module.exports = function (RED) {
  function EncodeNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.defaults = {
      source: config.source !== undefined ? config.source : "N0CALL",
      destination: config.destination !== undefined ? config.destination : "CQ",
      via: config.via !== undefined ? config.via : "",
      control: config.control !== undefined ? config.control : 3,
      pid: config.pid !== undefined ? config.pid : 240,
      frameType: config.frameType !== undefined ? config.frameType : "U",
      payload: config.payload !== undefined ? config.payload : ""
    };

    node.on("input", function (msg, send, done) {
      const localSend = send || function (m) {
        node.send(m);
      };
      const localDone = done || function () {};

      try {
        const source = pickValue(msg.source, node.defaults.source);
        const destination = pickValue(msg.destination, node.defaults.destination);
        const via = normalizeViaInput(
          pickValue(msg.via, node.defaults.via)
        );
        const frameType = pickValue(msg.frameType, node.defaults.frameType);
        const control = parseByte(pickValue(msg.control, node.defaults.control));
        const pid = parseByte(pickValue(msg.pid, node.defaults.pid));
        const payloadInput = pickValue(msg.payload, node.defaults.payload);
        const sourceHasBeenRepeated = pickValue(
          msg.sourceHasBeenRepeated,
          node.defaults.sourceHasBeenRepeated
        );
        const destinationHasBeenRepeated = pickValue(
          msg.destinationHasBeenRepeated,
          node.defaults.destinationHasBeenRepeated
        );

        const resolvedControl = control !== undefined ? control : controlFromFrameType(frameType);

        if (!source || !destination || resolvedControl === undefined) {
          localSend(
            errorEnvelope(
              "ENCODE_INPUT_INVALID",
              "source, destination, and control/frameType are required"
            )
          );
          localDone();
          return;
        }

        const payload = codec.encode({
          source,
          destination,
          sourceHasBeenRepeated,
          destinationHasBeenRepeated,
          via,
          control: resolvedControl,
          pid,
          payload: payloadInput
        });
        localSend(okEnvelope({
          event: "encoded",
          agwpePort: msg.agwpePort !== undefined
            ? msg.agwpePort
            : (msg.agwpePrefix !== undefined ? msg.agwpePrefix : null),
          payload
        }));
      } catch (error) {
        localSend(errorEnvelope("ENCODE_FAILED", error.message));
      }
      localDone();
    });
  }

  RED.nodes.registerType("encode", EncodeNode);
};
