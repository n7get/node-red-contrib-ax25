"use strict";

const EventEmitter = require("events");
const SessionRegistry = require("./session-registry");
const FrameRouter = require("./frame-router");

// Global bus: all instance buses forward conn-data/conn-lifecycle/conn-timeout-set here
// so nodes without a fixed config.client (e.g. Send) can subscribe once and receive
// events from any agwpe-client instance.
const globalBus = new EventEmitter();
globalBus.setMaxListeners(0);

// sessionIndex maps sessionId → instanceId so Send can derive the correct context
// from just a sessionId, without needing config.client on the node.
const sessionIndex = new Map();

function indexSession(sessionId, instanceId) {
  sessionIndex.set(sessionId, instanceId);
}

function unindexSession(sessionId) {
  sessionIndex.delete(sessionId);
}

function instanceIdForSession(sessionId) {
  return sessionIndex.get(sessionId) || null;
}

// Instance map for direct id-based lookup
const instances = new Map();

function createInstance(instanceId, logger) {
  const log = typeof logger === "function" ? logger : function () {};
  const bus = new EventEmitter();
  bus.setMaxListeners(0);
  const context = {
    instanceId,
    state: "disconnected",
    monitorEnabled: false,
    rawEnabled: false,
    rawWireEnabled: false,
    auth: null,
    callsigns: [],
    host: null,
    port: null,
    transport: null,
    bus,
    registry: new SessionRegistry(),
    router: new FrameRouter(log),
    logger: log
  };
  instances.set(instanceId, context);

  // Forward instance bus events to the global bus so Send nodes subscribed to
  // globalBus receive events from all instances, not just their configured one.
  ["conn-data", "conn-lifecycle", "conn-timeout-set"].forEach(function (evtName) {
    bus.on(evtName, function (evt) { globalBus.emit(evtName, evt); });
  });

  return context;
}

function getInstance(instanceId) {
  return instances.get(instanceId) || null;
}

function ensureInstance(instanceId) {
  let inst = getInstance(instanceId);
  if (!inst) {
    inst = createInstance(instanceId);
    instances.set(instanceId, inst);
  }
  return inst;
}

function removeInstance(instanceId) {
  instances.delete(instanceId);
}

function getAllInstances() {
  return Array.from(instances.values());
}

module.exports = {
  createInstance,
  getInstance,
  ensureInstance,
  removeInstance,
  getAllInstances,
  globalBus,
  indexSession,
  unindexSession,
  instanceIdForSession
};
