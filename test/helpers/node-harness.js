"use strict";

const EventEmitter = require("events");

const globalFlowContexts = new Map(); // Global map of flowId -> context data

function createHarness(...runtimeModules) {
  const types = {};
  const nodeRegistry = new Map();

  const RED = {
    nodes: {
      createNode(node, config) {
        const emitter = new EventEmitter();
        node._emitter = emitter;
        node.on = emitter.on.bind(emitter);
        node.emit = emitter.emit.bind(emitter);
        node.status = function (status) {
          node._status = status;
        };
        node.send = function (msg) {
          if (Array.isArray(msg)) {
            msg.forEach(function (m, i) {
              if (m != null) {
                node._sent.push(m);
                if (!node._sentByOutput) node._sentByOutput = [];
                if (!node._sentByOutput[i]) node._sentByOutput[i] = [];
                node._sentByOutput[i].push(m);
              }
            });
          } else if (msg != null) {
            node._sent.push(msg);
          }
        };
        node.error = function (err, msg) {
          node._errors.push({ err, msg });
        };
        node.warn = function (msg) {
          if (!node._warnings) node._warnings = [];
          node._warnings.push(msg);
        };
        node.log = function (msg) {
          if (!node._logs) node._logs = [];
          node._logs.push(msg);
        };

        // Add context() method for flow context support
        const flowId = node._flowId || "default-flow";
        if (!globalFlowContexts.has(flowId)) {
          globalFlowContexts.set(flowId, {});
        }

        node.context = function () {
          const flowData = globalFlowContexts.get(flowId);
          return {
            flow: {
              get: function (key) {
                return flowData[key] || null;
              },
              set: function (key, value) {
                flowData[key] = value;
              }
            }
          };
        };
      },
      registerType(type, ctor) {
        types[type] = ctor;
      },
      getNode(id) {
        return nodeRegistry.get(id) || null;
      }
    }
  };

  runtimeModules.forEach(function (mod) {
    mod(RED);
  });

  function instantiate(type, config) {
    const NodeCtor = types[type];
    if (!NodeCtor) {
      throw new Error("Type not registered: " + type);
    }
    const node = {
      id: (config && config.id) || type + "-id",
      _flowId: (config && config._flowId) || "default-flow",
      _sent: [],
      _errors: []
    };
    NodeCtor.call(node, config || {});
    nodeRegistry.set(node.id, node);
    return node;
  }

  return {
    instantiate
  };
}

module.exports = {
  createHarness
};
