"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");
const codec = require("../../lib/ax25-codec");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const uiInRuntime = require("../../nodes/ui-in");
const { buildAgwpeFrame } = require("../../lib/agwpe-frame-builder");

function makeMockTransport() {
  const t = new EventEmitter();
  t.sendFrame = function (_frame, cb) { if (cb) cb(null); };
  t.close = function (cb) { if (cb) cb(); };
  return t;
}

describe("integration: ui transport frame reception", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("decodes inbound AGWPE K-frame AX.25 UI payloads into ui-in output", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime, uiInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: mockTransport });
    const input = h.instantiate("ui-in", { id: "ui-in-1", client: "client-1" });

    const ax25Ui = codec.encode({
      source: "N0CALL",
      destination: "APRS",
      via: ["WIDE1-1", "WIDE2-2"],
      control: 0x03,
      pid: 0xf0,
      payload: "hello ui"
    });
    mockTransport.emit("frame", buildAgwpeFrame({ kind: "K", from: "N0CALL", to: "APRS", payload: ax25Ui }));

    assert.strictEqual(input._sent.length, 1);
    assert.strictEqual(input._sent[0].status, "ok");
    assert.strictEqual(input._sent[0].event, "ui");
    assert.strictEqual(input._sent[0].source, "N0CALL");
    assert.strictEqual(input._sent[0].destination, "APRS");
    assert.strictEqual(input._sent[0].via.length, 2);
    assert.strictEqual(input._sent[0].payload.toString("utf8"), "hello ui");
  });

  it("ignores non-UI AX.25 frames carried in K payload", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime, uiInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: mockTransport });
    const input = h.instantiate("ui-in", { id: "ui-in-1", client: "client-1" });

    const ax25IFrame = codec.encode({ source: "N0CALL", destination: "APRS", control: 0x00, pid: 0xf0, payload: "not ui" });
    mockTransport.emit("frame", buildAgwpeFrame({ kind: "K", from: "N0CALL", to: "APRS", payload: ax25IFrame }));

    assert.strictEqual(input._sent.length, 0);
  });

  it("does not emit ui-in output when raw mode is disabled", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime, uiInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: false, _testTransport: mockTransport });
    const input = h.instantiate("ui-in", { id: "ui-in-1", client: "client-1" });

    const ax25Ui = codec.encode({ source: "N0CALL", destination: "APRS", control: 0x03, pid: 0xf0, payload: "hello ui" });
    mockTransport.emit("frame", buildAgwpeFrame({ kind: "K", from: "N0CALL", to: "APRS", payload: ax25Ui }));

    assert.strictEqual(input._sent.length, 0);
  });

  it("supports payloadOutput=string", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime, uiInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: mockTransport });
    const input = h.instantiate("ui-in", { id: "ui-in-1", client: "client-1", payloadOutput: "string" });

    const ax25Ui = codec.encode({ source: "N0CALL", destination: "APRS", control: 0x03, pid: 0xf0, payload: "hello string" });
    mockTransport.emit("frame", buildAgwpeFrame({ kind: "K", from: "N0CALL", to: "APRS", payload: ax25Ui }));

    assert.strictEqual(input._sent.length, 1);
    assert.strictEqual(typeof input._sent[0].payload, "string");
    assert.strictEqual(input._sent[0].payload, "hello string");
  });
});
