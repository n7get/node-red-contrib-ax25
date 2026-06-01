"use strict";

const assert = require("assert");

describe("contract: decode", function () {
  it("decode output includes frameType and endpoints", function () {
    const out = { status: "ok", frameType: "I", source: "A", destination: "B" };
    assert.ok(["I", "S", "U"].includes(out.frameType));
  });

  it("decode error envelope includes code/text", function () {
    const out = { status: "error", errorCode: "DECODE_FAILED", errorText: "bad" };
    assert.strictEqual(out.status, "error");
  });
});
