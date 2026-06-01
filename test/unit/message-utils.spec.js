"use strict";

const assert = require("assert");
const { okEnvelope, errorEnvelope, chunkEnvelope } = require("../../lib/message-utils");

describe("message-utils", function () {
  it("builds success envelope", function () {
    const msg = okEnvelope({ event: "connected" });

    assert.strictEqual(msg.status, "ok");
    assert.strictEqual(msg.event, "connected");
    assert.ok(msg.timestamp);
  });

  it("builds error envelope", function () {
    const msg = errorEnvelope("E_TEST", "Test error", { instanceId: "x" });

    assert.strictEqual(msg.status, "error");
    assert.strictEqual(msg.errorCode, "E_TEST");
    assert.strictEqual(msg.instanceId, "x");
  });

  it("validates chunk envelope semantics", function () {
    assert.throws(function () {
      chunkEnvelope({ messageId: "m1", chunkIndex: 2, chunkCount: 2 });
    }, /chunkIndex must be less than chunkCount/);
  });
});
