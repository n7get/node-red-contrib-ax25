"use strict";

const assert = require("assert");
const { splitPayload, buildChunkMetadata } = require("../../lib/frame-segmentation");

describe("frame-segmentation", function () {
  it("splits payload above 255 bytes", function () {
    const input = Buffer.alloc(600, 0x61);
    const chunks = splitPayload(input, 255);

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0].length, 255);
    assert.strictEqual(chunks[1].length, 255);
    assert.strictEqual(chunks[2].length, 90);
  });

  it("creates chunk metadata with index/count", function () {
    const chunks = buildChunkMetadata("hello", { chunkSize: 2, messageId: "m1" });

    assert.strictEqual(chunks.length, 3);
    assert.strictEqual(chunks[0].messageId, "m1");
    assert.strictEqual(chunks[0].chunkIndex, 0);
    assert.strictEqual(chunks[0].chunkCount, 3);
  });
});
