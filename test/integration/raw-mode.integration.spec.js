"use strict";

const assert = require("assert");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const rawOutRuntime = require("../../nodes/raw-out");
const rawInRuntime = require("../../nodes/raw-in");
const encodeRuntime = require("../../nodes/encode");

describe("integration: raw mode", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("gates raw send behind raw mode (raw=false gives error)", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: false, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    out.emit("input", { payload: Buffer.from([0x01]) });
    assert.strictEqual(out._sent[0].status, "error");
  });

  it("allows raw send and receive when raw=true in config", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    out.emit("input", { payload: Buffer.from([0x02]) });
    assert.strictEqual(out._sent[out._sent.length - 1].event, "raw-sent");
    assert.ok(input._sent.length >= 1, "raw-in should receive the looped-back frame");
  });

  it("strips AGWPE 0x00 pad byte and emits agwpePort", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    const ax25Bytes = Buffer.from([0x82, 0xa0, 0xa8, 0x66, 0x62, 0x62]);
    const kFramePayload = Buffer.concat([Buffer.from([0x00]), ax25Bytes]);
    out.emit("input", { payload: kFramePayload });

    const msg = input._sent[input._sent.length - 1];
    assert.ok(msg, "raw-in should have emitted a message");
    assert.ok(Buffer.isBuffer(msg.payload), "payload should be a Buffer");
    assert.strictEqual(msg.payload[0], 0x82, "payload should start with AX.25 bytes, not the 0x00 pad");
    assert.strictEqual(typeof msg.agwpePort, "number", "agwpePort should be a number");
    assert.strictEqual(msg.agwpePort, 0x00, "agwpePort should contain the stripped pad byte");
  });

  it("sets agwpePort to 0 when payload starts with AX.25 bytes directly", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    out.emit("input", { payload: Buffer.from([0x82, 0xa0, 0xa8]) });

    const msg = input._sent[input._sent.length - 1];
    assert.ok(msg, "raw-in should have emitted a message");
    assert.strictEqual(msg.payload[0], 0x82, "payload should be unchanged");
    assert.strictEqual(msg.agwpePort, 0, "agwpePort should default to 0 when no pad byte");
  });

  it("accepts raw-out payload as byte array", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    out.emit("input", { payload: [0x82, 0xa0, 0xa8] });

    const msg = input._sent[input._sent.length - 1];
    assert.ok(msg, "raw-in should have emitted a message");
    assert.ok(Buffer.isBuffer(msg.payload), "payload should be a Buffer");
    assert.strictEqual(msg.payload.toString("hex"), "82a0a8");
  });

  it("accepts raw-out payload as hex string", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    out.emit("input", { payload: "82 a0 a8" });

    const msg = input._sent[input._sent.length - 1];
    assert.ok(msg, "raw-in should have emitted a message");
    assert.ok(Buffer.isBuffer(msg.payload), "payload should be a Buffer");
    assert.strictEqual(msg.payload.toString("hex"), "82a0a8");
  });

  it("accepts direct output message from encode node", function () {
    const h = createHarness(agwpeClientRuntime, encodeRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const encode = h.instantiate("encode", { id: "encode-1", source: "N0CALL", destination: "CQ", control: 0x03, pid: 0xf0 });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    encode.emit("input", { payload: "hello" });
    const encodedMsg = encode._sent[encode._sent.length - 1];
    out.emit("input", encodedMsg);

    const msg = input._sent[input._sent.length - 1];
    assert.ok(msg, "raw-in should have emitted a message");
    assert.ok(Buffer.isBuffer(msg.payload), "payload should be a Buffer");
    assert.strictEqual(msg.payload.toString("hex"), encodedMsg.payload.toString("hex"));
  });

  it("accepts nested encode output envelope in msg.payload", function () {
    const h = createHarness(agwpeClientRuntime, encodeRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const encode = h.instantiate("encode", { id: "encode-1", source: "N0CALL", destination: "CQ", control: 0x03, pid: 0xf0 });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1" });
    const input = h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    encode.emit("input", { payload: "hello" });
    const encodedMsg = encode._sent[encode._sent.length - 1];
    out.emit("input", { payload: encodedMsg });

    const msg = input._sent[input._sent.length - 1];
    assert.ok(msg, "raw-in should have emitted a message");
    assert.ok(Buffer.isBuffer(msg.payload), "payload should be a Buffer");
    assert.strictEqual(msg.payload.toString("hex"), encodedMsg.payload.toString("hex"));
  });

  it("uses editor agwpePort default when msg.agwpePort is not provided", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1", agwpePort: 0 });
    h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    const context = store.getInstance("client-1");
    let captured = null;
    context.bus.on("raw-data", function (frame) { captured = frame; });

    out.emit("input", { payload: [0x82, 0xa0, 0xa8] });
    assert.ok(captured, "raw-out should emit raw-data on bus");
    assert.strictEqual(typeof captured.agwpePort, "number", "agwpePort should be a number");
    assert.strictEqual(captured.agwpePort, 0x00);
  });

  it("uses msg.agwpePort to override editor agwpePort", function () {
    const h = createHarness(agwpeClientRuntime, rawOutRuntime, rawInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, raw: true, _testTransport: {} });
    const out = h.instantiate("raw-out", { id: "raw-out-1", client: "client-1", agwpePort: 0 });
    h.instantiate("raw-in", { id: "raw-in-1", client: "client-1" });

    const context = store.getInstance("client-1");
    let captured = null;
    context.bus.on("raw-data", function (frame) { captured = frame; });

    out.emit("input", { payload: [0x82, 0xa0, 0xa8], agwpePort: 7 });
    assert.ok(captured, "raw-out should emit raw-data on bus");
    assert.strictEqual(typeof captured.agwpePort, "number", "agwpePort should be a number");
    assert.strictEqual(captured.agwpePort, 7);
  });
});
