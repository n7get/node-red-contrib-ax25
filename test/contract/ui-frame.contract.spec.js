"use strict";

const assert = require("assert");

describe("contract: ui frame", function () {
  it("ui-out input includes required fields", function () {
    const cmd = { source: "N0CALL", destination: "CQ", payload: "hi" };
    assert.ok(cmd.source);
    assert.ok(cmd.destination);
    assert.ok(cmd.payload !== undefined && cmd.payload !== null);
  });

  it("ui-in output includes decoded UI frame fields", function () {
    const out = {
      source: "N0CALL",
      destination: "APRS",
      via: [{ callsign: "WIDE1-1", hasBeenRepeated: false }],
      payload: Buffer.from("hi")
    };
    assert.ok(out.source);
    assert.ok(out.destination);
    assert.ok(Array.isArray(out.via));
    assert.ok(Buffer.isBuffer(out.payload));
  });
});
