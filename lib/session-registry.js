"use strict";

const { nowTimestamp, makeMessageId } = require("./message-utils");

function SessionRegistry() {
  this.byInstance = new Map();
  this.byServerSession = new Map();
}

SessionRegistry.prototype._instanceMap = function (instanceId) {
  if (!this.byInstance.has(instanceId)) {
    this.byInstance.set(instanceId, new Map());
  }
  return this.byInstance.get(instanceId);
};

SessionRegistry.prototype.create = function (instanceId, input) {
  const payload = input || {};
  const store = this._instanceMap(instanceId);
  const sessionId = payload.sessionId || makeMessageId("sess");

  if (store.has(sessionId)) {
    throw new Error("SESSION_ID_CONFLICT");
  }

  const now = nowTimestamp();
  const session = {
    sessionId,
    instanceId,
    sourceCallsign: payload.sourceCallsign || payload.source || "",
    destinationCallsign: payload.destinationCallsign || payload.destination || "",
    state: payload.state || "connecting",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: null,
    mode: payload.mode || "binary",
    timeoutMs: payload.timeoutMs || null,
    serverSessionId: payload.serverSessionId || null,
    metadata: payload.metadata || {}
  };

  store.set(sessionId, session);
  if (session.serverSessionId !== null && session.serverSessionId !== undefined) {
    this.byServerSession.set(instanceId + ":" + String(session.serverSessionId), sessionId);
  }

  return Object.assign({}, session);
};

SessionRegistry.prototype.get = function (instanceId, sessionId) {
  const store = this.byInstance.get(instanceId);
  if (!store || !store.has(sessionId)) {
    return null;
  }
  return Object.assign({}, store.get(sessionId));
};

SessionRegistry.prototype.list = function (instanceId) {
  const store = this.byInstance.get(instanceId);
  if (!store) {
    return [];
  }
  return Array.from(store.values()).map(function (item) {
    return Object.assign({}, item);
  });
};

SessionRegistry.prototype.update = function (instanceId, sessionId, patch) {
  const store = this.byInstance.get(instanceId);
  if (!store || !store.has(sessionId)) {
    return null;
  }
  const current = store.get(sessionId);
  const next = Object.assign({}, current, patch || {}, { updatedAt: nowTimestamp() });
  store.set(sessionId, next);
  return Object.assign({}, next);
};

SessionRegistry.prototype.bindServerSessionId = function (instanceId, sessionId, serverSessionId) {
  const store = this.byInstance.get(instanceId);
  if (!store || !store.has(sessionId)) {
    return null;
  }

  const key = instanceId + ":" + String(serverSessionId);
  const previousSessionId = this.byServerSession.get(key);
  if (previousSessionId && previousSessionId !== sessionId) {
    this.byServerSession.delete(key);
    return {
      collision: true,
      previousSessionId,
      serverSessionId
    };
  }

  this.byServerSession.set(key, sessionId);
  return {
    collision: false,
    sessionId,
    serverSessionId
  };
};

SessionRegistry.prototype.resolveByServerSessionId = function (instanceId, serverSessionId) {
  const key = instanceId + ":" + String(serverSessionId);
  const sessionId = this.byServerSession.get(key);
  if (!sessionId) {
    return null;
  }
  return this.get(instanceId, sessionId);
};

SessionRegistry.prototype.remove = function (instanceId, sessionId) {
  const store = this.byInstance.get(instanceId);
  if (!store || !store.has(sessionId)) {
    return false;
  }

  const value = store.get(sessionId);
  if (value && value.serverSessionId !== null && value.serverSessionId !== undefined) {
    this.byServerSession.delete(instanceId + ":" + String(value.serverSessionId));
  }
  store.delete(sessionId);
  return true;
};

SessionRegistry.prototype.clearInstance = function (instanceId) {
  const store = this.byInstance.get(instanceId);
  if (!store) {
    return;
  }
  store.forEach(
    function (value) {
      if (value.serverSessionId !== null && value.serverSessionId !== undefined) {
        this.byServerSession.delete(instanceId + ":" + String(value.serverSessionId));
      }
    }.bind(this)
  );
  this.byInstance.delete(instanceId);
};

module.exports = SessionRegistry;
