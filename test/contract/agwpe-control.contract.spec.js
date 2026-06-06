"use strict";

const assert = require("assert");
const EventEmitter = require("events");
const store = require("../../lib/runtime-store");
const { createHarness } = require("../helpers/node-harness");

const agwpeClientRuntime = require("../../nodes/agwpe-client");
const agwpeControlRuntime = require("../../nodes/agwpe-control");

function makeMockTransport() {
  const t = new EventEmitter();
  t.sentFrames = [];
  t.open = function (host, port, cb) { if (cb) cb(null); };
  t.sendFrame = function (frame, cb) { t.sentFrames.push(frame); if (cb) cb(); };
  t.close = function (cb) { if (cb) cb(); };
  return t;
}

function makeHarness() {
  return createHarness(agwpeClientRuntime, agwpeControlRuntime);
}

describe("contract: agwpe-control", function () {
  let h;
  let client;

  beforeEach(function () {
    h = makeHarness();
    client = h.instantiate("agwpe-client", {
      id: "ctrl-client-1",
      host: "127.0.0.1",
      port: 8000,
      callsigns: "N0CALL",
      _testTransport: makeMockTransport()
    });
  });

  afterEach(function () {
    store.removeInstance("ctrl-client-1");
  });

  describe("get-config", function () {
    it("outputs current host, port, callsigns, username, and state", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "get-config" });

      assert.strictEqual(ctrl._sent.length, 1);
      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "ok");
      assert.strictEqual(out.command, "get-config");
      assert.ok(out.config, "should include config object");
      assert.strictEqual(out.config.host, "127.0.0.1");
      assert.strictEqual(out.config.port, 8000);
      assert.deepStrictEqual(out.config.callsigns, ["N0CALL"]);
      assert.strictEqual(out.config.username, "");
      assert.strictEqual(out.config.state, "connected");
    });
  });

  describe("set-config", function () {
    it("updates host and port", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "set-config", host: "10.0.0.1", port: 9000 });

      assert.strictEqual(ctrl._sent.length, 1);
      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "ok");
      assert.strictEqual(out.command, "set-config");
      assert.strictEqual(out.config.host, "10.0.0.1");
      assert.strictEqual(out.config.port, 9000);
    });

    it("updates callsigns as a string", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "set-config", callsigns: "W1AW,W1AW-1" });

      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "ok");
      assert.deepStrictEqual(out.config.callsigns, ["W1AW,W1AW-1"]);
    });

    it("updates callsigns as an array", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "set-config", callsigns: ["W1AW", "W1AW-1"] });

      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "ok");
      assert.deepStrictEqual(out.config.callsigns, ["W1AW", "W1AW-1"]);
    });

    it("updates auth when both username and password are provided", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "set-config", username: "user1", password: "pass1" });

      const ctx = store.getInstance("ctrl-client-1");
      assert.deepStrictEqual(ctx.auth, { username: "user1", password: "pass1" });
      assert.strictEqual(ctrl._sent[0].status, "ok");
    });

    it("clears auth when only username is provided and no prior password", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "set-config", username: "user1" });

      const ctx = store.getInstance("ctrl-client-1");
      assert.strictEqual(ctx.auth, null);
    });

    it("returns updated config in the output", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "set-config", host: "192.168.1.1" });

      const out = ctrl._sent[0];
      assert.strictEqual(out.config.host, "192.168.1.1");
    });
  });

  describe("connect", function () {
    it("outputs ok with event connecting", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "connect" });

      assert.strictEqual(ctrl._sent.length, 1);
      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "ok");
      assert.strictEqual(out.command, "connect");
      assert.strictEqual(out.event, "connecting");
    });
  });

  describe("disconnect", function () {
    it("outputs ok with event disconnected", function (done) {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "disconnect" });

      // transport.close() is synchronous in the mock, so the callback fires before
      // setImmediate; this just ensures we're past any internal ticks.
      setImmediate(function () {
        assert.strictEqual(ctrl._sent.length, 1);
        const out = ctrl._sent[0];
        assert.strictEqual(out.status, "ok");
        assert.strictEqual(out.command, "disconnect");
        assert.strictEqual(out.event, "disconnected");
        done();
      });
    });

    it("sets client state to disconnected", function (done) {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "disconnect" });

      setImmediate(function () {
        const ctx = store.getInstance("ctrl-client-1");
        assert.strictEqual(ctx.state, "disconnected");
        done();
      });
    });
  });

  describe("get-status", function () {
    it("returns state connected for a connected client", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "get-status" });

      assert.strictEqual(ctrl._sent.length, 1);
      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "ok");
      assert.strictEqual(out.command, "get-status");
      assert.strictEqual(out.payload.state, "connected");
    });

    it("returns monitorEnabled and rawEnabled as booleans", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "get-status" });

      const out = ctrl._sent[0];
      assert.strictEqual(typeof out.payload.monitorEnabled, "boolean");
      assert.strictEqual(typeof out.payload.rawEnabled, "boolean");
    });

    it("returns sessions as an array", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "get-status" });

      const out = ctrl._sent[0];
      assert.ok(Array.isArray(out.payload.sessions));
    });
  });

  describe("error handling", function () {
    it("outputs CLIENT_NOT_FOUND when client config node is missing", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-missing",
        client: "nonexistent-id"
      });

      ctrl.emit("input", { command: "get-config" });

      assert.strictEqual(ctrl._sent.length, 1);
      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "error");
      assert.strictEqual(out.errorCode, "CLIENT_NOT_FOUND");
    });

    it("outputs UNKNOWN_COMMAND for an unrecognised command", function () {
      const ctrl = h.instantiate("agwpe-control", {
        id: "ctrl-1",
        client: "ctrl-client-1"
      });

      ctrl.emit("input", { command: "explode" });

      assert.strictEqual(ctrl._sent.length, 1);
      const out = ctrl._sent[0];
      assert.strictEqual(out.status, "error");
      assert.strictEqual(out.errorCode, "UNKNOWN_COMMAND");
    });
  });
});
