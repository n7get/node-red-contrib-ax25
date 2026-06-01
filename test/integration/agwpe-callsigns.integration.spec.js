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

describe("integration: agwpe callsigns", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("stores callsigns provided in config", function () {
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0CALL", "N0CALL-1"],
      _testTransport: makeMockTransport()
    });

    const ctx = store.getInstance("client-1");
    assert.deepStrictEqual(ctx.callsigns, ["N0CALL", "N0CALL-1"]);
  });

  it("normalizes string callsign to array", function () {
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: "N0CALL",
      _testTransport: makeMockTransport()
    });

    const ctx = store.getInstance("client-1");
    assert.deepStrictEqual(ctx.callsigns, ["N0CALL"]);
  });

  it("defaults to empty callsigns array when not provided", function () {
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      _testTransport: makeMockTransport()
    });

    const ctx = store.getInstance("client-1");
    assert.deepStrictEqual(ctx.callsigns, []);
  });

  it("sends AGWPE X registration frames for provided callsigns", function () {
    const mockTransport = makeMockTransport();
    const h = createHarness(agwpeClientRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0CALL", "N0CALL-1"],
      _testTransport: mockTransport
    });

    const xFrames = mockTransport.sentFrames.filter(function (f) {
      return f.readUInt8(4) === "X".charCodeAt(0);
    });
    assert.strictEqual(xFrames.length, 2);
  });
});
