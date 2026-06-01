"use strict";

const EventEmitter = require("events");
const { prettyPrintAgwpeFrame } = require("./agwpe-frame-pretty");

class FrameRouter extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger || function () {};
    this.instances = new Map();
  }

  registerInstance(instanceId, handlers) {
    this.instances.set(instanceId, handlers || {});
  }

  unregisterInstance(instanceId) {
    this.instances.delete(instanceId);
  }

  route(instanceId, frame) {
    const handlers = this.instances.get(instanceId);
    if (!handlers) {
      this.logger(`Frame routing failed: no handlers for instanceId ${instanceId}`);
      return false;
    }

    this.logger(`${prettyPrintAgwpeFrame(frame, { direction: "route" })} | instanceId=${instanceId}`);

    if (
      frame.kind === "connected-data" &&
      typeof handlers.onConnectedData === "function"
    ) {
      this.logger(`Frame routing: connected-data to ${instanceId}`);
      handlers.onConnectedData(frame);
      return true;
    }

    if (
      frame.kind === "connected" &&
      frame.sessionId &&
      typeof handlers.onConnectedBySession === "function"
    ) {
      this.logger(`Frame routing: connected(sessionId: ${frame.sessionId}) to ${instanceId}`);
      handlers.onConnectedBySession(frame.sessionId, frame);
      return true;
    }

    if (frame.kind === "connected" && typeof handlers.onConnected === "function") {
      this.logger(`Frame routing: connected to ${instanceId}`);
      handlers.onConnected(frame);
      return true;
    }

    if (frame.kind === "disconnected" && typeof handlers.onDisconnected === "function") {
      this.logger(`Frame routing: disconnected to ${instanceId}`);
      handlers.onDisconnected(frame);
      return true;
    }

    if (frame.kind === "ui" && typeof handlers.onUi === "function") {
      this.logger(`Frame routing: ui to ${instanceId}`);
      handlers.onUi(frame);
      return true;
    }

    if (frame.kind === "monitor" && typeof handlers.onMonitor === "function") {
      this.logger(`Frame routing: monitor to ${instanceId}`);
      handlers.onMonitor(frame);
      return true;
    }

    if (frame.kind === "raw" && typeof handlers.onRaw === "function") {
      this.logger(`Frame routing: raw to ${instanceId}`);
      handlers.onRaw(frame);
      return true;
    }

    if (frame.kind === "outstanding-response" && typeof handlers.onOutstandingResponse === "function") {
      this.logger(`Frame routing: outstanding-response to ${instanceId}`);
      handlers.onOutstandingResponse(frame);
      return true;
    }

    if (frame.kind === "lifecycle" && typeof handlers.onLifecycle === "function") {
      this.logger(`Frame routing: lifecycle to ${instanceId}`);
      handlers.onLifecycle(frame);
      return true;
    }

    return false;
  }
}

module.exports = FrameRouter;
