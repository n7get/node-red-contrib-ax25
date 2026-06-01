"use strict";

const { okEnvelope } = require("../lib/message-utils");

module.exports = function (RED) {
  function MonitorInNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    const cfg = RED.nodes.getNode(config.client);
    const context = cfg ? cfg.instance : null;
    if (!context) {
      node.status({ fill: "red", shape: "ring", text: "client missing" });
      return;
    }

    const onMonitorData = function (frame) {
      if (!context.monitorEnabled) {
        return;
      }
      node.send(
        okEnvelope({
          instanceId: context.instanceId,
          event: "monitor",
          payload: frame.payload,
          source: frame.source,
          destination: frame.destination,
          via: frame.via || []
        })
      );
    };

    context.bus.on("monitor-data", onMonitorData);

    node.on("close", function (removed, done) {
      context.bus.off("monitor-data", onMonitorData);
      done();
    });
  }

  RED.nodes.registerType("monitor-in", MonitorInNode);
};
