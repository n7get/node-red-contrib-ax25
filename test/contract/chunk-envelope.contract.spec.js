"use strict";

const assert = require("assert");
const { chunkEnvelope } = require("../../lib/message-utils");

describe("contract: chunk envelope", function () {
  it("requires messageId and valid chunk bounds", function () {
    assert.throws(function () {
      chunkEnvelope({ chunkIndex: 0, chunkCount: 1 });
    }, /messageId is required/);

    assert.throws(function () {
      chunkEnvelope({ messageId: "m1", chunkIndex: -1, chunkCount: 1 });
    }, /chunkIndex must be a non-negative integer/);
  });

  it("accepts valid envelope", function () {
    const envelope = chunkEnvelope({
      messageId: "m1",
      chunkIndex: 0,
      chunkCount: 1,
      payload: "abc"
    });

    assert.strictEqual(envelope.messageId, "m1");
    assert.strictEqual(envelope.chunkIndex, 0);
    assert.strictEqual(envelope.chunkCount, 1);
  });
});
