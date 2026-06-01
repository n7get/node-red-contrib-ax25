"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const monitorInRuntime = require("../../nodes/monitor-in");

function makeMockTransport() {
  const t = new EventEmitter();
  t.sentFrames = [];
  t.sendFrame = function (frame, cb) { t.sentFrames.push(frame); if (cb) cb(); };
  t.close = function (cb) { if (cb) cb(); };
  return t;
}

describe("integration: agwpe monitor toggle", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("sends AGWPE m toggle frame when monitor=true in config", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      monitor: true,
      _testTransport: mockTransport
    });

    assert.ok(mockTransport.sentFrames.some(function (frame) {
      return frame.readUInt8(4) === "m".charCodeAt(0);
    }), "m toggle frame should be sent when monitor=true in config");
  });

  it("routes monitor data to monitor-in node when monitor=true in config", function () {
    const h = createHarness(agwpeClientRuntime, monitorInRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      monitor: true,
      _testTransport: makeMockTransport()
    });
    const monitor = h.instantiate("monitor-in", { id: "monitor-1", client: "client-1" });

    const ctx = store.getInstance("client-1");
    ctx.bus.emit("monitor-data", { payload: "hello", source: "A", destination: "B" });

    assert.strictEqual(monitor._sent.length, 1);
    assert.strictEqual(monitor._sent[0].event, "monitor");
  });
});
