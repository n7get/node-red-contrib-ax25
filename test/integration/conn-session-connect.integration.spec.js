"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const connInRuntime = require("../../nodes/connect");

function makeMockTransport() {
  const t = new EventEmitter();
  t.sentFrames = [];
  t.open = function (host, port, cb) { if (cb) cb(null); };
  t.sendFrame = function (frame, cb) { t.sentFrames.push(frame); if (cb) cb(); };
  t.close = function (cb) { if (cb) cb(); };
  return t;
}

describe("integration: conn session connect", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("creates multiple sessions for same instance", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);

    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0CALL"],
      _testTransport: makeMockTransport()
    });

    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "N0CALL", destination: "R1" });
    inp.emit("input", { command: "connect", source: "N0CALL", destination: "R2" });

    const sessions = store.getInstance("client-1").registry.list("client-1");
    assert.strictEqual(sessions.length, 2);
  });

  it("uses first config callsign as source when connect source is missing", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);

    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0CALL", "N0CALL-1"],
      _testTransport: makeMockTransport()
    });

    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", destination: "R1", sessionId: "s-fallback" });

    const session = store.getInstance("client-1").registry.get("client-1", "s-fallback");
    assert.strictEqual(session.sourceCallsign, "N0CALL");
    assert.strictEqual(session.destinationCallsign, "R1");
  });
});
