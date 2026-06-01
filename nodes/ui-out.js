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

module.exports = function (RED) {
  function UiOutNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const cfg = RED.nodes.getNode(config.client);
    const context0 = cfg ? cfg.instance : null;

    node.defaults = {
      source: config.source !== undefined ? config.source : "",
      destination: config.destination !== undefined ? config.destination : "",
      via: config.via !== undefined ? config.via : "",
      payload: config.payload !== undefined ? config.payload : ""
    };

    node.on("input", function (msg, send, done) {
      const localSend = send || function (m) {
        node.send(m);
      };
      const localDone = done || function () {};

      const context = context0;
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

      const source = pickValue(msg.source, node.defaults.source);
      const destination = pickValue(msg.destination, node.defaults.destination);
      const via = normalizeViaInput(pickValue(msg.via, node.defaults.via));
      const payloadInput = pickValue(msg.payload, node.defaults.payload);

      if (!source || !destination || payloadInput === undefined || payloadInput === null || source === "" || destination === "" || payloadInput === "") {
        localSend(errorEnvelope("UI_SEND_INVALID", "ui-out requires source, destination, and payload (set in editor or input message)"));
        localDone();
        return;
      }

      let payload;
      try {
        payload = codec.encode({
          source,
          destination,
          via,
          control: 0x03,
          pid: 0xf0,
          payload: payloadInput
        });
      } catch (error) {
        localSend(errorEnvelope("UI_SEND_INVALID", error.message));
        localDone();
        return;
      }

      context.bus.emit("raw-data", {
        instanceId: context.instanceId,
        direction: "tx",
        source,
        destination,
        payload,
        agwpePort: msg.agwpePort
      });

      localSend(okEnvelope({ instanceId: context.instanceId, event: "ui-sent" }));
      localDone();
    });
  }

  RED.nodes.registerType("ui-out", UiOutNode);
};
