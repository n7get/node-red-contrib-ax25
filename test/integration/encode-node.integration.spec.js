"use strict";

const assert = require("assert");
const codec = require("../../lib/ax25-codec");
const { createHarness } = require("../helpers/node-harness");

const encodeRuntime = require("../../nodes/encode");

describe("integration: encode node defaults and overrides", function () {
  it("uses UI-frame defaults when message does not provide fields", function () {
    const node = createHarness(encodeRuntime).instantiate("encode", {});

    node.emit("input", {});

    assert.strictEqual(node._sent.length, 1);
    assert.strictEqual(node._sent[0].status, "ok");
    assert.strictEqual(node._sent[0].event, "encoded");

    const decoded = codec.decode(node._sent[0].payload);
    assert.strictEqual(decoded.source, "N0CALL");
    assert.strictEqual(decoded.destination, "CQ");
    assert.strictEqual(decoded.control, 0x03);
    assert.strictEqual(decoded.pid, 0xf0);
    assert.strictEqual(decoded.frameType, "U");
  });

  it("lets input message override editor defaults", function () {
    const node = createHarness(encodeRuntime).instantiate("encode", {
      source: "CFG1",
      destination: "CFG2",
      control: 0x03,
      pid: 0xf0,
      payload: "cfg"
    });

    node.emit("input", {
      source: "MSG1",
      destination: "MSG2",
      control: 0x03,
      pid: 0xf0,
      payload: "msg"
    });

    assert.strictEqual(node._sent.length, 1);
    assert.strictEqual(node._sent[0].status, "ok");

    const decoded = codec.decode(node._sent[0].payload);
    assert.strictEqual(decoded.source, "MSG1");
    assert.strictEqual(decoded.destination, "MSG2");
    assert.strictEqual(decoded.payload.toString("utf8"), "msg");
  });

  it("splits via in editor string by comma and/or space", function () {
    const node = createHarness(encodeRuntime).instantiate("encode", {
      source: "N0CALL",
      destination: "APRS",
      control: 0x03,
      pid: 0xf0,
      via: "WIDE1-1, WIDE2-2  WIDE3-3"
    });

    node.emit("input", { payload: "test" });

    assert.strictEqual(node._sent.length, 1);
    assert.strictEqual(node._sent[0].status, "ok");

    const decoded = codec.decode(node._sent[0].payload);
    assert.deepStrictEqual(
      decoded.via.map(function (d) {
        return d.callsign;
      }),
      ["WIDE1-1", "WIDE2-2", "WIDE3-3"]
    );
  });

  it("splits via in input message string members", function () {
    const node = createHarness(encodeRuntime).instantiate("encode", {
      source: "N0CALL",
      destination: "APRS",
      control: 0x03,
      pid: 0xf0
    });

    node.emit("input", {
      payload: "test",
      via: [
        "WIDE1-1, WIDE2-2",
        { callsign: "WIDE3-3 WIDE4-4", hasBeenRepeated: true }
      ]
    });

    assert.strictEqual(node._sent.length, 1);
    assert.strictEqual(node._sent[0].status, "ok");

    const decoded = codec.decode(node._sent[0].payload);
    assert.deepStrictEqual(
      decoded.via.map(function (d) {
        return d.callsign;
      }),
      ["WIDE1-1", "WIDE2-2", "WIDE3-3", "WIDE4-4"]
    );
    assert.deepStrictEqual(
      decoded.via.map(function (d) {
        return d.hasBeenRepeated;
      }),
      [false, false, true, true]
    );
  });
});
