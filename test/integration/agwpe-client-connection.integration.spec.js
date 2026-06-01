"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");
const { makeConnectFrame, makeDisconnectFrame } = require("../../lib/agwpe-frame-builder");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const connInRuntime = require("../../nodes/connect");
const connOutRuntime = require("../../nodes/send");
const disconnectRuntime = require("../../nodes/disconnect");

function makeMockTransport() {
  const t = new EventEmitter();
  t.sentFrames = [];
  t.open = function (host, port, cb) { if (cb) cb(null); };
  t.sendFrame = function (frame, cb) { t.sentFrames.push(frame); if (cb) cb(); };
  t.close = function (cb) { if (cb) cb(); };
  return t;
}

describe("integration: agwpe-client connection", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("auto-connects at construction with _testTransport", function () {
    const h = createHarness(agwpeClientRuntime);
    const node = h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      _testTransport: makeMockTransport()
    });

    assert.strictEqual(node._status.fill, "green");
    assert.strictEqual(node._status.text, "connected");
  });

  it("exposes node.instance for consumer nodes", function () {
    const h = createHarness(agwpeClientRuntime);
    const node = h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      _testTransport: makeMockTransport()
    });

    assert.ok(node.instance, "node.instance should be set");
    assert.strictEqual(node.instance.instanceId, "client-1");
    assert.strictEqual(node.instance.state, "connected");
  });

  it("reads config values at construction", function () {
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "10.0.0.15",
      port: 9000,
      callsigns: "N0CALL",
      username: "u",
      password: "p",
      monitor: true,
      raw: true,
      _testTransport: makeMockTransport()
    });

    const ctx = store.getInstance("client-1");
    assert.strictEqual(ctx.host, "10.0.0.15");
    assert.strictEqual(ctx.port, 9000);
    assert.deepStrictEqual(ctx.callsigns, ["N0CALL"]);
    assert.deepStrictEqual(ctx.auth, { username: "u", password: "p" });
    assert.strictEqual(ctx.monitorEnabled, true);
    assert.strictEqual(ctx.rawEnabled, true);
  });

  it("falls back to defaults when config omits host/port", function () {
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      _testTransport: makeMockTransport()
    });

    const ctx = store.getInstance("client-1");
    assert.strictEqual(ctx.host, "127.0.0.1");
    assert.strictEqual(ctx.port, 8000);
  });

  it("shows config error status when host is missing", function () {
    const h = createHarness(agwpeClientRuntime);
    const node = h.instantiate("agwpe-client", {
      id: "client-1",
      host: "",
      port: 8000
    });

    assert.strictEqual(node._status.fill, "red");
  });

  it("closes cleanly when node.on close fires", function (done) {
    const h = createHarness(agwpeClientRuntime);
    const node = h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      _testTransport: makeMockTransport()
    });

    node.emit("close", true, function () {
      assert.ok(!store.getInstance("client-1"), "instance should be removed on close");
      done();
    });
  });

  it("consumer connect node finds config via RED.nodes.getNode", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);
    const mockTransport = makeMockTransport();

    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0CALL"],
      _testTransport: mockTransport
    });

    const inp = h.instantiate("connect", {
      id: "connect-1",
      client: "client-1"
    });

    assert.ok(!inp._status || inp._status.fill !== "red", "connect node should find client");
  });

  it("handles connect via connect node and receives connected event on connect output", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);
    const mockTransport = makeMockTransport();

    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0CALL"],
      _testTransport: mockTransport
    });

    const inp = h.instantiate("connect", {
      id: "connect-1",
      client: "client-1"
    });

    inp.emit("input", { source: "N0CALL", destination: "N1CALL-1" });

    const afterConnect = inp._sent[inp._sent.length - 1];
    assert.strictEqual(afterConnect.status, "ok");
    assert.strictEqual(afterConnect.event, "connecting");
    assert.ok(typeof afterConnect.sessionId === "string");

    // Simulate TNC sending C frame confirmation
    mockTransport.emit("frame", makeConnectFrame("N1CALL-1", "N0CALL"));

    const afterCFrame = inp._sent[inp._sent.length - 1];
    assert.strictEqual(afterCFrame.status, "ok");
    assert.strictEqual(afterCFrame.event, "connected");
    assert.strictEqual(afterCFrame.sessionId, afterConnect.sessionId);
  });

  it("handles disconnect confirmed by TNC d frame", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime, disconnectRuntime);
    const mockTransport = makeMockTransport();

    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0CALL"],
      _testTransport: mockTransport
    });

    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    h.instantiate("send", { id: "send-1" });
    const disc = h.instantiate("disconnect", { id: "disconnect-1" });

    inp.emit("input", { source: "N0CALL", destination: "N1CALL-1", sessionId: "sess-disc" });
    mockTransport.emit("frame", makeConnectFrame("N1CALL-1", "N0CALL"));

    disc.emit("input", { sessionId: "sess-disc" });
    mockTransport.emit("frame", makeDisconnectFrame("N1CALL-1", "N0CALL"));

    const last = inp._sent[inp._sent.length - 1];
    assert.strictEqual(last.status, "ok");
    assert.strictEqual(last.event, "disconnected");
    assert.strictEqual(last.sessionId, "sess-disc");
  });
});
