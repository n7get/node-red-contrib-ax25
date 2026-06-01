"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const codec = require("../../lib/ax25-codec");

describe("integration: decode classification", function () {
  it("classifies I/S/U fixtures", function () {
    const base = path.join(__dirname, "..", "fixtures", "ax25-corpus");
    const i = codec.decode(fs.readFileSync(path.join(base, "i-frame.bin")));
    const s = codec.decode(fs.readFileSync(path.join(base, "s-frame.bin")));
    const u = codec.decode(fs.readFileSync(path.join(base, "u-frame.bin")));

    assert.strictEqual(i.frameType, "I");
    assert.strictEqual(s.frameType, "S");
    assert.strictEqual(u.frameType, "U");
  });
});
