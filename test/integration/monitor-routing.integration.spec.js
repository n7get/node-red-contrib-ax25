"use strict";

const assert = require("assert");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const monitorInRuntime = require("../../nodes/monitor-in");

describe("integration: monitor routing", function () {
  afterEach(function () {
    store.removeInstance("client-1");
  });

  it("emits monitor data only when monitor mode is enabled", function () {
    // With monitor=false (default): no output
    const h1 = createHarness(agwpeClientRuntime, monitorInRuntime);
    h1.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      monitor: false,
      _testTransport: {}
    });
    const monitor1 = h1.instantiate("monitor-in", { id: "monitor-1", client: "client-1" });

    const ctx = store.getInstance("client-1");
    ctx.bus.emit("monitor-data", { payload: "a", source: "A", destination: "B" });
    assert.strictEqual(monitor1._sent.length, 0, "should not emit when monitor disabled");

    store.removeInstance("client-1");

    // With monitor=true: output received
    const h2 = createHarness(agwpeClientRuntime, monitorInRuntime);
    h2.instantiate("agwpe-client", {
      id: "client-1",
      host: "127.0.0.1",
      port: 8000,
      monitor: true,
      _testTransport: {}
    });
    const monitor2 = h2.instantiate("monitor-in", { id: "monitor-2", client: "client-1" });

    const ctx2 = store.getInstance("client-1");
    ctx2.bus.emit("monitor-data", { payload: "b", source: "A", destination: "B" });
    assert.strictEqual(monitor2._sent.length, 1, "should emit when monitor enabled");
  });
});
