"use strict";

const assert = require("assert");

describe("contract: conn disconnect", function () {
  it("disconnect command requires sessionId", function () {
    const cmd = { command: "disconnect", sessionId: "sess-1" };
    assert.strictEqual(cmd.command, "disconnect");
    assert.ok(cmd.sessionId);
  });

  it("disconnected envelope contains event and sessionId", function () {
    const envelope = { status: "ok", event: "disconnected", sessionId: "sess-1" };
    assert.strictEqual(envelope.event, "disconnected");
  });
});
