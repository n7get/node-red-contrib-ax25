"use strict";

const assert = require("assert");

describe("contract: agwpe callsigns", function () {
  it("callsigns must be an array when provided", function () {
    const open = { command: "open", host: "127.0.0.1", port: 8000, callsigns: ["N0CALL", "N0CALL-1"] };
    assert.ok(Array.isArray(open.callsigns));
  });
});
