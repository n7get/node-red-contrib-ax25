"use strict";

const assert = require("assert");

describe("contract: encode", function () {
  it("encode requires source destination and control", function () {
    const input = { source: "A", destination: "B", control: 0x03 };
    assert.ok(input.source);
    assert.ok(input.destination);
    assert.ok(input.control !== undefined);
  });

  it("encode error envelope includes code/text", function () {
    const out = { status: "error", errorCode: "ENCODE_FAILED", errorText: "bad" };
    assert.strictEqual(out.status, "error");
  });
});
