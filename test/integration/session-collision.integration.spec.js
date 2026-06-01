"use strict";

const assert = require("assert");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const connInRuntime = require("../../nodes/connect");

describe("integration: session collision", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("retains active session integrity on server session collision", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["A"],
      _testTransport: {}
    });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });

    inp.emit("input", { command: "connect", source: "A", destination: "B", sessionId: "s1" });
    inp.emit("input", { command: "connect", source: "A", destination: "C", sessionId: "s2" });

    const sessions = store.getInstance("client-1").registry.list("client-1");
    assert.strictEqual(sessions.length, 2);
  });
});
