"use strict";

const assert = require("assert");

describe("contract: monitor envelope", function () {
  it("includes monitor event and addressing fields", function () {
    const envelope = { status: "ok", event: "monitor", source: "A", destination: "B", payload: "x" };
    assert.strictEqual(envelope.event, "monitor");
    assert.ok("source" in envelope);
    assert.ok("destination" in envelope);
  });
});
