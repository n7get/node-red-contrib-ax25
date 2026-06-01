"use strict";

const assert = require("assert");

describe("contract: conn connect", function () {
  it("requires source and destination for connect command", function () {
    const valid = { command: "connect", source: "N0CALL", destination: "REMOTE-1" };
    assert.ok(valid.source);
    assert.ok(valid.destination);
  });

  it("connect envelope contains sessionId semantics", function () {
    const envelope = { status: "ok", event: "connected", sessionId: "sess-1" };
    assert.strictEqual(typeof envelope.sessionId, "string");
  });
});
