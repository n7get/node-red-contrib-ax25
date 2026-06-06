"use strict";

const { okEnvelope, errorEnvelope } = require("../lib/message-utils");

module.exports = function (RED) {
  function AgwpeControlNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.status({});

    node.on("input", function (msg, send, done) {
      const localSend = send || function (m) { node.send(m); };
      const localDone = done || function () {};

      const configNode = RED.nodes.getNode(config.client);
      if (!configNode || !configNode.instance || !configNode.instance.control) {
        localSend(errorEnvelope("CLIENT_NOT_FOUND", "agwpe-client config node not found", { command: msg.command }));
        localDone();
        return;
      }

      const control = configNode.instance.control;
      const command = msg.command;

      if (command === "disconnect") {
        control.disconnect(function () {
          localSend(okEnvelope({ command: "disconnect", event: "disconnected" }));
          localDone();
        });
        return;
      }

      if (command === "set-config") {
        const fields = {};
        if (msg.host !== undefined) fields.host = msg.host;
        if (msg.port !== undefined) fields.port = msg.port;
        if (msg.callsigns !== undefined) fields.callsigns = msg.callsigns;
        if (msg.username !== undefined) fields.username = msg.username;
        if (msg.password !== undefined) fields.password = msg.password;
        control.setConfig(fields);
        localSend(okEnvelope({ command: "set-config", config: control.getConfig() }));
        localDone();
        return;
      }

      if (command === "connect") {
        control.connect();
        localSend(okEnvelope({ command: "connect", event: "connecting" }));
        localDone();
        return;
      }

      if (command === "get-config") {
        localSend(okEnvelope({ command: "get-config", config: control.getConfig() }));
        localDone();
        return;
      }

      if (command === "get-status") {
        localSend(okEnvelope({ command: "get-status", payload: control.getStatus() }));
        localDone();
        return;
      }

      localSend(errorEnvelope("UNKNOWN_COMMAND", "Unknown command: " + command, { command }));
      localDone();
    });
  }

  RED.nodes.registerType("agwpe-control", AgwpeControlNode);
};
