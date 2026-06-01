"use strict";

const assert = require("assert");
const { chunkEnvelope } = require("../../lib/message-utils");

describe("contract: conn chunk envelope", function () {
  it("enforces metadata fields", function () {
    const env = chunkEnvelope({ messageId: "m1", chunkIndex: 0, chunkCount: 2, payload: "a" });
    assert.strictEqual(env.messageId, "m1");
    assert.strictEqual(env.chunkIndex, 0);
    assert.strictEqual(env.chunkCount, 2);
  });
});
