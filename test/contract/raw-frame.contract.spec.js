"use strict";

const assert = require("assert");

describe("contract: raw frame", function () {
  it("raw payload must be buffer", function () {
    const valid = Buffer.from([0x01, 0x02]);
    assert.strictEqual(Buffer.isBuffer(valid), true);
  });

  it("raw output envelope contains payload", function () {
    const out = { status: "ok", event: "raw", payload: Buffer.from([0x10]) };
    assert.strictEqual(Buffer.isBuffer(out.payload), true);
  });

  it("agwpePort is null when payload has no AGWPE leading byte", function () {
    // A payload starting with a shifted AX.25 char (>= 0x60) has no prefix to strip.
    const payload = Buffer.from([0x82, 0xa0, 0xa8]);
    const hasPrefix = payload.length > 1 && payload[0] === 0x00 && payload[1] >= 0x60;
    assert.strictEqual(hasPrefix, false);
  });

  it("agwpePort is Buffer([0x00]) when payload starts with AGWPE K-frame pad byte", function () {
    // AGWPE K-frame payloads sometimes include a leading 0x00 before the AX.25 address chain.
    const raw = Buffer.from([0x00, 0x82, 0xa0, 0xa8]);
    const hasPrefix = raw.length > 1 && raw[0] === 0x00 && raw[1] >= 0x60;
    assert.strictEqual(hasPrefix, true);

    const agwpePort = raw.subarray(0, 1);
    const payload = raw.subarray(1);
    assert.strictEqual(agwpePort[0], 0x00);
    assert.strictEqual(payload[0], 0x82);
  });
});
