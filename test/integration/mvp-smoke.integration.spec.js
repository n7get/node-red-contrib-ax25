"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");
const { makeConnectFrame, makeDisconnectFrame } = require("../../lib/agwpe-frame-builder");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const connOutRuntime = require("../../nodes/send");
const connInRuntime = require("../../nodes/connect");
const disconnectRuntime = require("../../nodes/disconnect");

describe("integration: MVP smoke", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("connect send disconnect full session lifecycle", function () {
    const mockTransport = new EventEmitter();
    mockTransport.sentFrames = [];
    mockTransport.sendFrame = function (frame, cb) {
      mockTransport.sentFrames.push(frame);
      // Synchronously acknowledge y (outstanding-query) frames with Y outstanding=0
      // so the send node's flow-control path completes without waiting for a timeout.
      if (Buffer.isBuffer(frame) && frame.length >= 36 && frame[4] === 0x79 /* 'y' */) {
        const yResponse = Buffer.alloc(36);
        frame.copy(yResponse);
        yResponse[4] = 0x59; // 'Y'
        yResponse.writeUInt32LE(0, 28); // outstanding = 0
        mockTransport.emit("frame", yResponse);
      }
      if (cb) cb();
    };
    mockTransport.close = function (cb) { if (cb) cb(); };

    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime, disconnectRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0"],
      _testTransport: mockTransport
    });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });
    const disc = h.instantiate("disconnect", { id: "disconnect-1" });

    // Connect session
    inp.emit("input", { source: "N0", destination: "R1", sessionId: "s1" });
    const connectingMsg = inp._sent.find(function (m) { return m.event === "connecting"; });
    assert.ok(connectingMsg, "should emit connecting");

    // TNC confirms connection
    mockTransport.emit("frame", makeConnectFrame("R1", "N0"));
    const connectedMsg = inp._sent.find(function (m) { return m.event === "connected"; });
    assert.ok(connectedMsg, "should emit connected");

    // Send data
    out.emit("input", { sessionId: "s1", payload: "hello" });
    const sentMsg = out._sent.find(function (m) { return m.event === "sent"; });
    assert.ok(sentMsg, "should emit sent");

    // Disconnect
    disc.emit("input", { sessionId: "s1" });
    mockTransport.emit("frame", makeDisconnectFrame("R1", "N0"));

    const disconnectedMsg = inp._sent.find(function (m) { return m.event === "disconnected"; });
    assert.ok(disconnectedMsg, "should emit disconnected after TNC d frame");
    assert.strictEqual(disconnectedMsg.sessionId, "s1");
  });
});
