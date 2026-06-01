"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const rawInRuntime = require("../../nodes/raw-in");
const { buildAgwpeFrame } = require("../../lib/agwpe-frame-builder");

function makeMockTransport() {
  const t = new EventEmitter();
  t.sendFrame = function (_frame, cb) { if (cb) cb(null); };
  t.close = function (cb) { if (cb) cb(); };
  return t;
}

describe("integration: raw transport frame reception", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("routes transport frames through router to raw-in when enabled", function () {
    const h = createHarness(agwpeClientRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    const context = store.getInstance("client-1");
    context.router.route(context.instanceId, {
      kind: "raw",
      payload: Buffer.from([0xa0, 0x9e, 0x82, 0xa4, 0x9c, 0x62]),
      source: "N0",
      destination: "CQ"
    });

    assert.strictEqual(input._sent.length, 1);
    assert.deepStrictEqual(input._sent[0].payload, Buffer.from([0xa0, 0x9e, 0x82, 0xa4, 0x9c, 0x62]));
    assert.strictEqual(input._sent[0].event, "raw");
  });

  it("does not route frames to raw-in when disabled", function () {
    const h = createHarness(agwpeClientRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: false, _testTransport: {} });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    const context = store.getInstance("client-1");
    context.router.route(context.instanceId, {
      kind: "raw",
      payload: Buffer.from([0xa0, 0x9e, 0x82, 0xa4, 0x9c, 0x62]),
      source: "N0",
      destination: "CQ"
    });

    assert.strictEqual(input._sent.length, 0);
  });

  it("parses inbound AGWPE K-frame buffers and emits raw-in output", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: mockTransport });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    const rawPayload = Buffer.from([0x9e, 0x9e, 0x9e, 0x9e, 0x9e, 0x9e, 0x9e, 0x9e, 0x9e, 0x82]);
    const wireFrame = buildAgwpeFrame({ kind: "K", from: "N0CALL", to: "APRS", payload: rawPayload });
    mockTransport.emit("frame", wireFrame);

    assert.strictEqual(input._sent.length, 1);
    assert.strictEqual(input._sent[0].source, "N0CALL");
    assert.strictEqual(input._sent[0].destination, "APRS");
    assert.deepStrictEqual(input._sent[0].payload, rawPayload);
    assert.strictEqual(input._sent[0].event, "raw");
  });

  it("does not emit raw-in output for inbound AGWPE U frames", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: mockTransport });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    const wireFrame = buildAgwpeFrame({
      kind: "U",
      from: "N0CALL",
      to: "APRS",
      payload: Buffer.from("should not route to raw-in")
    });
    mockTransport.emit("frame", wireFrame);

    assert.strictEqual(input._sent.length, 0);
  });
});
