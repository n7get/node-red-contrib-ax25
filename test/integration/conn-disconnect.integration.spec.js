"use strict";

const assert = require("assert");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const connOutRuntime = require("../../nodes/send");
const connInRuntime = require("../../nodes/connect");
const disconnectRuntime = require("../../nodes/disconnect");

describe("integration: conn disconnect", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("disconnect removes session and blocks later send", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime, disconnectRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0"],
      _testTransport: {}
    });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });
    const disc = h.instantiate("disconnect", { id: "disconnect-1" });

    inp.emit("input", { source: "N0", destination: "R1", sessionId: "s1" });
    disc.emit("input", { sessionId: "s1" });
    out.emit("input", { sessionId: "s1", payload: "x" });

    const last = out._sent[out._sent.length - 1];
    assert.strictEqual(last.status, "error");
  });
});
