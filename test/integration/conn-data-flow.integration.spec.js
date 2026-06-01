"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");
const { makeDataFrame, makeConnectFrame } = require("../../lib/agwpe-frame-builder");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const connOutRuntime = require("../../nodes/send");
const connInRuntime = require("../../nodes/connect");

function createEventMockTransport() {
  const transport = new EventEmitter();
  transport.sentFrames = [];
  transport.sendFrame = function (frame, cb) {
    transport.sentFrames.push(frame);
    if (cb) cb();
  };
  transport.close = function (cb) { if (cb) cb(); };
  return transport;
}

describe("integration: conn data flow", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("segments outbound payload into three chunks for 600-byte payload", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N0"], _testTransport: {} });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s1", mode: "binary" });
    store.getInstance("client-1").registry.update("client-1", "s1", { state: "connected" });
    out.emit("input", { command: "send", sessionId: "s1", payload: Buffer.alloc(600, 0x61) });

    const sentResult = out._sent[out._sent.length - 1];
    assert.strictEqual(sentResult.status, "ok");
    assert.strictEqual(sentResult.chunkCount, 3);
  });

  it("emits incoming binary data from conn-in", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, _testTransport: {} });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    const context = store.getInstance("client-1");
    context.registry.create("client-1", { sessionId: "s1", source: "N0", destination: "R1", state: "connected" });

    context.bus.emit("conn-data", {
      direction: "rx",
      sessionId: "s1",
      payload: Buffer.from("hello"),
      source: "R1",
      destination: "N0"
    });

    assert.strictEqual(inp._sent.length, 1);
    assert.strictEqual(inp._sent[0].event, "data");
    assert.ok(Buffer.isBuffer(inp._sent[0].payload));
    assert.strictEqual(inp._sent[0].payload.toString(), "hello");
    assert.strictEqual(inp._sent[0].sessionId, "s1");
  });

  it("buffers and emits complete lines in line mode", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, _testTransport: {} });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    const context = store.getInstance("client-1");
    context.registry.create("client-1", { sessionId: "s2", source: "N0", destination: "R1", state: "connected", mode: "line" });

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s2", payload: Buffer.from("hel"), source: "R1", destination: "N0" });
    assert.strictEqual(inp._sent.length, 0);

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s2", payload: Buffer.from("lo\r"), source: "R1", destination: "N0" });
    assert.strictEqual(inp._sent.length, 1);
    assert.strictEqual(inp._sent[0].payload, "hello");
    assert.strictEqual(inp._sent[0].event, "data");
  });

  it("sends each array payload item as a separate D frame", function () {
    const sentFrames = [];
    const mockTransport = { sendFrame: function (frame, cb) { sentFrames.push(frame); if (cb) cb(); } };

    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N0"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s-arr", mode: "line" });
    store.getInstance("client-1").registry.update("client-1", "s-arr", { state: "connected" });
    out.emit("input", { command: "send", sessionId: "s-arr", payload: ["cmd1", "cmd2", "cmd3"] });

    const ack = out._sent[out._sent.length - 1];
    assert.strictEqual(ack.status, "ok");
    assert.strictEqual(ack.chunkCount, 3);

    const dFrames = sentFrames.filter(function (f) { return Buffer.isBuffer(f) && f[4] === 0x44; });
    assert.strictEqual(dFrames.length, 3, "should transmit one D frame per array item");
    assert.strictEqual(dFrames[0].subarray(36).toString(), "cmd1\r");
    assert.strictEqual(dFrames[1].subarray(36).toString(), "cmd2\r");
    assert.strictEqual(dFrames[2].subarray(36).toString(), "cmd3\r");
  });

  it("sends array payload items as binary D frames when session is in binary mode", function () {
    const sentFrames = [];
    const mockTransport = { sendFrame: function (frame, cb) { sentFrames.push(frame); if (cb) cb(); } };

    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N0"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s-arrbin", mode: "binary" });
    store.getInstance("client-1").registry.update("client-1", "s-arrbin", { state: "connected" });
    out.emit("input", { command: "send", sessionId: "s-arrbin", payload: [Buffer.from("AAA"), Buffer.from("BBB")] });

    const dFrames = sentFrames.filter(function (f) { return Buffer.isBuffer(f) && f[4] === 0x44; });
    assert.strictEqual(dFrames.length, 2, "should transmit one D frame per array item");
    assert.strictEqual(dFrames[0].subarray(36).toString(), "AAA");
    assert.strictEqual(dFrames[1].subarray(36).toString(), "BBB");
  });

  it("rejects an array payload if any item is not string or Buffer", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N0"], _testTransport: {} });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s-badarr", mode: "line" });
    store.getInstance("client-1").registry.update("client-1", "s-badarr", { state: "connected" });
    out.emit("input", { command: "send", sessionId: "s-badarr", payload: ["ok", 42, "also-ok"] });

    const errMsg = out._sent.find(function (m) { return m.status === "error"; });
    assert.ok(errMsg, "should emit an error for invalid array item");
    assert.strictEqual(errMsg.errorCode, "PAYLOAD_INVALID");
  });

  it("appends CR to outbound payload in line mode", function () {
    const sentFrames = [];
    const mockTransport = { sendFrame: function (frame, cb) { sentFrames.push(frame); if (cb) cb(); } };

    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N0"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s3", mode: "line" });
    store.getInstance("client-1").registry.update("client-1", "s3", { state: "connected" });
    out.emit("input", { command: "send", sessionId: "s3", payload: "hello" });

    const dataFrame = sentFrames.find(function (f) { return Buffer.isBuffer(f) && f[4] === 0x44; });
    assert.ok(dataFrame, "transport should receive a D data frame");
    assert.strictEqual(dataFrame.subarray(36).toString(), "hello\r");
  });

  it("routes inbound D frame from transport through to conn-in (full path)", function () {
    const mockTransport = createEventMockTransport();

    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N1CALL"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N1CALL", destination: "N1CALL-1", sessionId: "s-bbs", mode: "binary" });

    const { makeConnectFrame } = require("../../lib/agwpe-frame-builder");
    mockTransport.emit("frame", makeConnectFrame("N1CALL-1", "N1CALL"));

    const bssGreeting = "Welcome to ESP-TNC BBS\rBBS READY>\r";
    mockTransport.emit("frame", makeDataFrame("N1CALL-1", "N1CALL", Buffer.from(bssGreeting)));

    const dataMsg = inp._sent.find(function (m) { return m.event === "data"; });
    assert.ok(dataMsg, "conn-in should emit a data message for the D frame");
    assert.strictEqual(dataMsg.sessionId, "s-bbs");
    assert.ok(Buffer.isBuffer(dataMsg.payload));
    assert.strictEqual(dataMsg.payload.toString(), bssGreeting);
  });

  it("routes inbound D frame when TNC echoes C frame with our callsign as source", function () {
    const mockTransport = createEventMockTransport();

    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N1CALL"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N1CALL", destination: "N0CALL-1", sessionId: "s-bbs2", mode: "binary" });

    const { makeConnectFrame } = require("../../lib/agwpe-frame-builder");
    mockTransport.emit("frame", makeConnectFrame("N1CALL", "N0CALL-1"));
    mockTransport.emit("frame", makeDataFrame("N0CALL-1", "N1CALL", Buffer.from("BBS READY\r")));

    const dataMsg = inp._sent.find(function (m) { return m.event === "data"; });
    assert.ok(dataMsg, "conn-in should emit a data message even when C frame callsigns are in request order");
    assert.strictEqual(dataMsg.sessionId, "s-bbs2");
  });

  it("routes inbound data to conn-out after conn-out sends", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, _testTransport: {} });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    const context = store.getInstance("client-1");
    context.registry.create("client-1", { sessionId: "s1", source: "N0", destination: "R1", state: "connected", mode: "binary" });
    store.indexSession("s1", "client-1");

    out.emit("input", { command: "send", sessionId: "s1", payload: "cmd" });

    context.bus.emit("conn-data", {
      direction: "rx",
      sessionId: "s1",
      payload: Buffer.from("response"),
      source: "R1",
      destination: "N0"
    });

    assert.strictEqual(out._sent.length, 2);
    const dataMsg = out._sent.find(function (m) { return m.event === "data"; });
    assert.ok(dataMsg, "inbound data should arrive on conn-out");
    assert.strictEqual(dataMsg.payload.toString(), "response");
    assert.strictEqual(inp._sent.length, 0, "conn-in should not receive the data");
  });

  it("buffers lines until waitFor pattern matches, then emits combined payload", function () {
    const h = createHarness(agwpeClientRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, _testTransport: {} });
    const out = h.instantiate("send", { id: "send-1", waitFor: ">$" });

    const context = store.getInstance("client-1");
    context.registry.create("client-1", { sessionId: "s1", source: "N0", destination: "R1", state: "connected", mode: "line" });
    store.indexSession("s1", "client-1");

    out.emit("input", { command: "send", sessionId: "s1", payload: "L" });

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("Line 1\r"), source: "R1", destination: "N0" });
    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("Line 2\r"), source: "R1", destination: "N0" });
    assert.strictEqual(out._sent.filter(function (m) { return m.event === "data"; }).length, 0);

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("cmd>\r"), source: "R1", destination: "N0" });

    const dataMsgs = out._sent.filter(function (m) { return m.event === "data"; });
    assert.strictEqual(dataMsgs.length, 1, "should emit exactly one combined message");
    assert.deepStrictEqual(dataMsgs[0].payload, ["Line 1", "Line 2"]);
    assert.strictEqual(dataMsgs[0].match, "cmd>");
  });

  it("emits buffered lines when prompt arrives without trailing CR (fragment match)", function () {
    const h = createHarness(agwpeClientRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, _testTransport: {} });
    const out = h.instantiate("send", { id: "send-1", waitFor: ">$" });

    const context = store.getInstance("client-1");
    context.registry.create("client-1", { sessionId: "s1", source: "N0", destination: "R1", state: "connected", mode: "line" });
    store.indexSession("s1", "client-1");

    out.emit("input", { command: "send", sessionId: "s1", payload: "L" });

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("Line 1\r"), source: "R1", destination: "N0" });
    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("Line 2\r"), source: "R1", destination: "N0" });
    assert.strictEqual(out._sent.filter(function (m) { return m.event === "data"; }).length, 0);

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("cmd>"), source: "R1", destination: "N0" });

    const dataMsgs = out._sent.filter(function (m) { return m.event === "data"; });
    assert.strictEqual(dataMsgs.length, 1, "should emit exactly one combined message");
    assert.deepStrictEqual(dataMsgs[0].payload, ["Line 1", "Line 2"]);
    assert.strictEqual(dataMsgs[0].match, "cmd>");
  });

  it("applies Connect node waitFor for inbound sessions without an explicit connect command", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, _testTransport: {} });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1", waitFor: ">$" });

    const context = store.getInstance("client-1");
    context.registry.create("client-1", { sessionId: "s1", source: "N0", destination: "R1", state: "connected", mode: "line" });

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("Hello\r"), source: "R1", destination: "N0" });
    assert.strictEqual(inp._sent.filter(function (m) { return m.event === "data"; }).length, 0);

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("cmd>"), source: "R1", destination: "N0" });

    const dataMsgs = inp._sent.filter(function (m) { return m.event === "data"; });
    assert.strictEqual(dataMsgs.length, 1, "should emit once when fragment matches");
    assert.deepStrictEqual(dataMsgs[0].payload, ["Hello"]);
    assert.strictEqual(dataMsgs[0].match, "cmd>");
  });

  it("transitions session to connected via K-frame AX.25 UA (Kantronics-style TNC)", function () {
    const { encode } = require("../../lib/ax25-codec");
    const { makeRawFrame } = require("../../lib/agwpe-frame-builder");
    const mockTransport = createEventMockTransport();

    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N1CALL"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N1CALL", destination: "N0CALL-1", sessionId: "s-ka", mode: "binary" });

    const uaAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x73 });
    mockTransport.emit("frame", makeRawFrame("", "", uaAx25));

    const session = store.getInstance("client-1").registry.get("client-1", "s-ka");
    assert.strictEqual(session.state, "connected", "session should be connected after K-frame UA");

    const connMsg = inp._sent.find(function (m) { return m.event === "connected"; });
    assert.ok(connMsg, "connect node should emit a connected lifecycle event");
    assert.strictEqual(connMsg.sessionId, "s-ka");
  });

  it("routes inbound I-frame data via K-frame (Kantronics-style TNC)", function () {
    const { encode } = require("../../lib/ax25-codec");
    const { makeRawFrame } = require("../../lib/agwpe-frame-builder");
    const mockTransport = createEventMockTransport();

    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N1CALL"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N1CALL", destination: "N0CALL-1", sessionId: "s-kd", mode: "binary" });

    const uaAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x73 });
    mockTransport.emit("frame", makeRawFrame("", "", uaAx25));

    const greeting = "[KAMP-8.0-HM$]\r";
    const iFrameAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x00, pid: 0xF0, payload: Buffer.from(greeting) });
    mockTransport.emit("frame", makeRawFrame("", "", iFrameAx25));

    const dataMsg = inp._sent.find(function (m) { return m.event === "data"; });
    assert.ok(dataMsg, "connect node should emit a data message for K-frame I-frame");
    assert.strictEqual(dataMsg.sessionId, "s-kd");
    assert.ok(Buffer.isBuffer(dataMsg.payload));
    assert.strictEqual(dataMsg.payload.toString(), greeting);
  });

  it("delivers data exactly once when K-frame I-frame and D-frame carry the same data in one TCP segment", function () {
    const { encode } = require("../../lib/ax25-codec");
    const { makeRawFrame, makeDataFrame: mdf } = require("../../lib/agwpe-frame-builder");
    const mockTransport = createEventMockTransport();

    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N1CALL"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N1CALL", destination: "N0CALL-1", sessionId: "s-dedup", mode: "binary" });

    const uaAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x73 });
    mockTransport.emit("frame", makeRawFrame("", "", uaAx25));

    const greeting = "Hello\r";
    const iFrameAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x00, pid: 0xF0, payload: Buffer.from(greeting) });
    const kFrame = makeRawFrame("", "", iFrameAx25);
    const dFrame = mdf("N0CALL-1", "N1CALL", Buffer.from(greeting));
    mockTransport.emit("frame", Buffer.concat([kFrame, dFrame]));

    const dataMsgs = inp._sent.filter(function (m) { return m.event === "data"; });
    assert.strictEqual(dataMsgs.length, 1, "data should be delivered exactly once despite K-frame + D-frame duplicate");
    assert.ok(Buffer.isBuffer(dataMsgs[0].payload));
    assert.strictEqual(dataMsgs[0].payload.toString(), greeting);
  });

  it("delivers data exactly once when K-frame I-frame and D-frame carry the same data in separate TCP segments", function () {
    const { encode } = require("../../lib/ax25-codec");
    const { makeRawFrame } = require("../../lib/agwpe-frame-builder");
    const mockTransport = createEventMockTransport();

    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N1CALL"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N1CALL", destination: "N0CALL-1", sessionId: "s-dedup-cross", mode: "binary" });

    const uaAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x73 });
    mockTransport.emit("frame", makeRawFrame("", "", uaAx25));

    const greeting = "Hello cross-segment\r";
    const iFrameAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x00, pid: 0xF0, payload: Buffer.from(greeting) });
    mockTransport.emit("frame", makeRawFrame("", "", iFrameAx25));
    mockTransport.emit("frame", makeDataFrame("N0CALL-1", "N1CALL", Buffer.from(greeting)));

    const dataMsgs = inp._sent.filter(function (m) { return m.event === "data"; });
    assert.strictEqual(dataMsgs.length, 1, "data should be delivered exactly once when K-frame and D-frame arrive in different TCP segments");
    assert.strictEqual(dataMsgs[0].payload.toString(), greeting);
  });

  it("suppresses K-frame I-frames for subsequent messages once dFrameMode is established", function () {
    const { encode } = require("../../lib/ax25-codec");
    const { makeRawFrame } = require("../../lib/agwpe-frame-builder");
    const mockTransport = createEventMockTransport();

    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N1CALL"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N1CALL", destination: "N0CALL-1", sessionId: "s-dedup-mode", mode: "binary" });

    const uaAx25 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x73 });
    mockTransport.emit("frame", makeRawFrame("", "", uaAx25));

    const msg1 = "First\r";
    const iFrame1 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x00, pid: 0xF0, payload: Buffer.from(msg1) });
    mockTransport.emit("frame", makeRawFrame("", "", iFrame1));
    mockTransport.emit("frame", makeDataFrame("N0CALL-1", "N1CALL", Buffer.from(msg1)));

    const msg2 = "Second\r";
    const iFrame2 = encode({ source: "N0CALL-1", destination: "N1CALL", control: 0x02, pid: 0xF0, payload: Buffer.from(msg2) });
    mockTransport.emit("frame", makeRawFrame("", "", iFrame2));
    mockTransport.emit("frame", makeDataFrame("N0CALL-1", "N1CALL", Buffer.from(msg2)));

    const dataMsgs = inp._sent.filter(function (m) { return m.event === "data"; });
    assert.strictEqual(dataMsgs.length, 2, "exactly two messages delivered across both K+D pairs");
    assert.strictEqual(dataMsgs[0].payload.toString(), msg1);
    assert.strictEqual(dataMsgs[1].payload.toString(), msg2);
  });

  it("outputs lines individually when waitFor is empty", function () {
    const h = createHarness(agwpeClientRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, _testTransport: {} });
    const out = h.instantiate("send", { id: "send-1", waitFor: "" });

    const context = store.getInstance("client-1");
    context.registry.create("client-1", { sessionId: "s1", source: "N0", destination: "R1", state: "connected", mode: "line" });
    store.indexSession("s1", "client-1");

    out.emit("input", { command: "send", sessionId: "s1", payload: "L" });

    context.bus.emit("conn-data", { direction: "rx", sessionId: "s1", payload: Buffer.from("Line 1\rLine 2\r"), source: "R1", destination: "N0" });

    const dataMsgs = out._sent.filter(function (m) { return m.event === "data"; });
    assert.strictEqual(dataMsgs.length, 2);
    assert.strictEqual(dataMsgs[0].payload, "Line 1");
    assert.strictEqual(dataMsgs[1].payload, "Line 2");
  });

  it("send node emits a y query to the TNC before each chunk and proceeds when outstanding is 0", function () {
    const EventEmitter = require("events");
    const mockTransport = new EventEmitter();
    mockTransport.sentFrames = [];
    mockTransport.sendFrame = function (frame, cb) {
      mockTransport.sentFrames.push(frame);
      if (Buffer.isBuffer(frame) && frame.length >= 36 && frame[4] === 0x79 /* 'y' */) {
        const yResponse = Buffer.alloc(36);
        frame.copy(yResponse);
        yResponse[4] = 0x59; // 'Y'
        yResponse.writeUInt32LE(0, 28); // outstanding = 0 — TNC has room
        mockTransport.emit("frame", yResponse);
      }
      if (cb) cb();
    };
    mockTransport.close = function (cb) { if (cb) cb(); };

    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N0"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s-yfc", mode: "binary" });
    mockTransport.emit("frame", makeConnectFrame("R1", "N0"));

    out.emit("input", { command: "send", sessionId: "s-yfc", payload: "hello" });

    const yFrames = mockTransport.sentFrames.filter(function (f) {
      return Buffer.isBuffer(f) && f.length >= 36 && f[4] === 0x79;
    });
    assert.strictEqual(yFrames.length, 1, "one y query should be sent per chunk");
    assert.strictEqual(yFrames[0].toString("ascii", 8, 10), "N0", "y query CallFrom should be our callsign");
    assert.strictEqual(yFrames[0].toString("ascii", 18, 20), "R1", "y query CallTo should be remote callsign");

    const dFrames = mockTransport.sentFrames.filter(function (f) {
      return Buffer.isBuffer(f) && f.length >= 36 && f[4] === 0x44;
    });
    assert.strictEqual(dFrames.length, 1, "one D frame should be sent");
    assert.strictEqual(dFrames[0].subarray(36).toString(), "hello");

    const sentMsg = out._sent.find(function (m) { return m.event === "sent"; });
    assert.ok(sentMsg, "send node should emit sent event");
  });

  it("send node retries after Y_RETRY_DELAY when TNC reports queue full then clears", function (done) {
    const EventEmitter = require("events");
    const mockTransport = new EventEmitter();
    mockTransport.sentFrames = [];
    let yQueryCount = 0;
    mockTransport.sendFrame = function (frame, cb) {
      mockTransport.sentFrames.push(frame);
      if (Buffer.isBuffer(frame) && frame.length >= 36 && frame[4] === 0x79 /* 'y' */) {
        yQueryCount++;
        const yResponse = Buffer.alloc(36);
        frame.copy(yResponse);
        yResponse[4] = 0x59;
        // First query: report queue full (7 = MAX_OUTSTANDING).
        // Subsequent queries: report clear.
        yResponse.writeUInt32LE(yQueryCount === 1 ? 7 : 0, 28);
        mockTransport.emit("frame", yResponse);
      }
      if (cb) cb();
    };
    mockTransport.close = function (cb) { if (cb) cb(); };

    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", { id: "client-1", host: "127.0.0.1", port: 8000, callsigns: ["N0"], _testTransport: mockTransport });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s-yretry", mode: "binary" });
    mockTransport.emit("frame", makeConnectFrame("R1", "N0"));

    out.emit("input", { command: "send", sessionId: "s-yretry", payload: "retry-me" });

    // First query reports queue full — sent event deferred.
    assert.strictEqual(out._sent.filter(function (m) { return m.event === "sent"; }).length, 0,
      "sent event should not fire while TNC queue is full");

    // After Y_RETRY_DELAY_MS, the second query reports clear and the chunk is sent.
    setTimeout(function () {
      try {
        const sentMsg = out._sent.find(function (m) { return m.event === "sent"; });
        assert.ok(sentMsg, "sent event should fire after TNC queue clears");
        assert.strictEqual(yQueryCount, 2, "should have issued exactly two y queries");
        const dFrames = mockTransport.sentFrames.filter(function (f) {
          return Buffer.isBuffer(f) && f.length >= 36 && f[4] === 0x44;
        });
        assert.strictEqual(dFrames.length, 1, "D frame should be sent after backpressure clears");
        done();
      } catch (err) {
        done(err);
      }
    }, 500); // well above Y_RETRY_DELAY_MS (200 ms)
  });
});
