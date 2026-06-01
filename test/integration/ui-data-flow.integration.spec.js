"use strict";

const assert = require("assert");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");
const codec = require("../../lib/ax25-codec");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const uiOutRuntime = require("../../nodes/ui-out");
const uiInRuntime = require("../../nodes/ui-in");

describe("integration: ui data flow", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("ui-out encodes AX.25 UI frame to raw bus and ui-in decodes source/destination/via/payload", function () {
    const h = createHarness(agwpeClientRuntime, uiOutRuntime, uiInRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      raw: true,
      _testTransport: {}
    });
    const out = h.instantiate("ui-out", {
      id: "ui-out-1",
      client: "client-1",
      source: "N0DEFAULT",
      destination: "CQ",
      via: "WIDE1-1",
      payload: "default text"
    });
    const input = h.instantiate("ui-in", { id: "ui-in-1", client: "client-1" });

    out.emit("input", { source: "N0CALL", destination: "APRS", via: ["WIDE1-1", "WIDE2-2"], payload: "hello ui" });

    assert.strictEqual(input._sent.length, 1);
    assert.strictEqual(input._sent[0].status, "ok");
    assert.strictEqual(input._sent[0].event, "ui");
    assert.strictEqual(input._sent[0].source, "N0CALL");
    assert.strictEqual(input._sent[0].destination, "APRS");
    assert.strictEqual(input._sent[0].via.length, 2);
    assert.strictEqual(input._sent[0].via[0].callsign, "WIDE1-1");
    assert.strictEqual(input._sent[0].via[1].callsign, "WIDE2-2");
    assert.strictEqual(input._sent[0].payload.toString("utf8"), "hello ui");
  });

  it("message input overrides ui-out editor defaults", function () {
    let sentFrame = null;
    const testTransport = {
      on: function () {},
      sendFrame: function (frame, cb) { sentFrame = frame; if (typeof cb === "function") cb(null); }
    };
    const h = createHarness(agwpeClientRuntime, uiOutRuntime, uiInRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      raw: true,
      _testTransport: testTransport
    });
    const out = h.instantiate("ui-out", {
      id: "ui-out-1",
      client: "client-1",
      source: "N0DEFAULT",
      destination: "CQ",
      via: "WIDE1-1",
      payload: "default payload"
    });
    h.instantiate("ui-in", { id: "ui-in-1", client: "client-1" });

    out.emit("input", { source: "N1OVRD", destination: "APRS", via: "WIDE2-2", payload: "override payload" });

    assert.ok(Buffer.isBuffer(sentFrame));
    const agwpePayloadLen = sentFrame.readUInt32LE(28);
    const ax25Payload = sentFrame.subarray(36, 36 + agwpePayloadLen);
    const decoded = codec.decodeWireAx25(ax25Payload);

    assert.strictEqual(decoded.source, "N1OVRD");
    assert.strictEqual(decoded.destination, "APRS");
    assert.strictEqual(decoded.via.length, 1);
    assert.strictEqual(decoded.via[0].callsign, "WIDE2-2");
    assert.strictEqual(decoded.payload.toString("utf8"), "override payload");
  });

  it("ui-out uses editor defaults when no message input provided", function () {
    let sentFrame = null;
    const testTransport = {
      on: function () {},
      sendFrame: function (frame, cb) { sentFrame = frame; if (typeof cb === "function") cb(null); }
    };
    const h = createHarness(agwpeClientRuntime, uiOutRuntime, uiInRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      raw: true,
      _testTransport: testTransport
    });
    const out = h.instantiate("ui-out", {
      id: "ui-out-1",
      client: "client-1",
      source: "N0CALL",
      destination: "CQ",
      via: "",
      payload: "UI"
    });
    h.instantiate("ui-in", { id: "ui-in-1", client: "client-1" });

    out.emit("input", {});

    assert.ok(Buffer.isBuffer(sentFrame));
    const agwpePayloadLen = sentFrame.readUInt32LE(28);
    const ax25Payload = sentFrame.subarray(36, 36 + agwpePayloadLen);
    const decoded = codec.decodeWireAx25(ax25Payload);

    assert.strictEqual(decoded.source, "N0CALL");
    assert.strictEqual(decoded.destination, "CQ");
    assert.strictEqual(decoded.via.length, 0);
    assert.strictEqual(decoded.payload.toString("utf8"), "UI");
  });
});
