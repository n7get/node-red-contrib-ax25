"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");

function makeMockTransport() {
  const t = new EventEmitter();
  t.sentFrames = [];
  t.open = function (host, port, cb) { if (cb) cb(null); };
  t.sendFrame = function (frame, cb) { t.sentFrames.push(frame); if (cb) cb(); };
  t.close = function (cb) { if (cb) cb(); };
  return t;
}

describe("integration: agwpe-client mode config", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("sends k frame at connect time when raw=true", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      raw: true,
      _testTransport: mockTransport
    });

    const ctx = store.getInstance("client-1");
    assert.strictEqual(ctx.rawEnabled, true);
    assert.strictEqual(ctx.rawWireEnabled, true);

    const kFrame = mockTransport.sentFrames.find(function (f) {
      return f.readUInt8(4) === "k".charCodeAt(0);
    });
    assert.ok(kFrame, "k frame should be sent when raw=true");
  });

  it("does not send k frame when raw=false", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      raw: false,
      _testTransport: mockTransport
    });

    const ctx = store.getInstance("client-1");
    assert.strictEqual(ctx.rawEnabled, false);
    assert.strictEqual(ctx.rawWireEnabled, false);

    const kFrame = mockTransport.sentFrames.find(function (f) {
      return f.readUInt8(4) === "k".charCodeAt(0);
    });
    assert.ok(!kFrame, "k frame should NOT be sent when raw=false");
  });

  it("sends m frame at connect time when monitor=true", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      monitor: true,
      _testTransport: mockTransport
    });

    const ctx = store.getInstance("client-1");
    assert.strictEqual(ctx.monitorEnabled, true);
    assert.strictEqual(ctx.monitorWireEnabled, true);

    const mFrame = mockTransport.sentFrames.find(function (f) {
      return f.readUInt8(4) === "m".charCodeAt(0);
    });
    assert.ok(mFrame, "m frame should be sent when monitor=true");
  });

  it("does not send m frame when monitor=false", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      monitor: false,
      _testTransport: mockTransport
    });

    const ctx = store.getInstance("client-1");
    assert.strictEqual(ctx.monitorEnabled, false);

    const mFrame = mockTransport.sentFrames.find(function (f) {
      return f.readUInt8(4) === "m".charCodeAt(0);
    });
    assert.ok(!mFrame, "m frame should NOT be sent when monitor=false");
  });
});
