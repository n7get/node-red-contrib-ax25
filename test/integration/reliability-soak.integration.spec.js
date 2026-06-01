"use strict";

const assert = require("assert");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const connOutRuntime = require("../../nodes/send");
const connInRuntime = require("../../nodes/connect");

describe("integration: reliability soak", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("runs 1000-message send loop with zero envelope errors", function () {
    const h = createHarness(agwpeClientRuntime, connInRuntime, connOutRuntime);
    h.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: ["N0"],
      _testTransport: {}
    });
    const inp = h.instantiate("connect", { id: "connect-1", client: "client-1" });
    const out = h.instantiate("send", { id: "send-1" });

    inp.emit("input", { command: "connect", source: "N0", destination: "R1", sessionId: "s1" });
    // Simulate TNC C frame confirmation to transition session to "connected"
    store.getInstance("client-1").registry.update("client-1", "s1", { state: "connected" });

    let errors = 0;
    for (let i = 0; i < 1000; i += 1) {
      out.emit("input", { command: "send", sessionId: "s1", payload: "m" + i });
      const last = out._sent[out._sent.length - 1];
      if (last.status === "error") {
        errors += 1;
      }
    }

    assert.strictEqual(errors / 1000, 0);
  });
});
