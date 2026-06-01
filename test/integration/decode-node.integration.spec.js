"use strict";

const assert = require("assert");
const codec = require("../../lib/ax25-codec");
const { createHarness } = require("../helpers/node-harness");

const decodeRuntime = require("../../nodes/decode");

describe("integration: decode node payload output", function () {
  function makeEncodedFrame() {
    return codec.encode({
      source: "N0CALL",
      destination: "CQ",
      control: 0x03,
      pid: 0xf0,
      payload: "hello"
    });
  }

  it("emits payload as string by default", function () {
    const node = createHarness(decodeRuntime).instantiate("decode", {});

    node.emit("input", { payload: makeEncodedFrame() });

    assert.strictEqual(node._sent.length, 1);
    assert.strictEqual(node._sent[0].status, "ok");
    assert.strictEqual(typeof node._sent[0].payload, "string");
    assert.strictEqual(node._sent[0].payload, "hello");
  });

  it("emits payload as Buffer when payloadOutput=buffer", function () {
    const node = createHarness(decodeRuntime).instantiate("decode", { payloadOutput: "buffer" });

    node.emit("input", { payload: makeEncodedFrame() });

    assert.strictEqual(node._sent.length, 1);
    assert.strictEqual(node._sent[0].status, "ok");
    assert.strictEqual(Buffer.isBuffer(node._sent[0].payload), true);
    assert.strictEqual(node._sent[0].payload.toString("utf8"), "hello");
  });
});
