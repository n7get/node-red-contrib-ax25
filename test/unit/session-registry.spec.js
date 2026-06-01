"use strict";

const assert = require("assert");
const SessionRegistry = require("../../lib/session-registry");

describe("session-registry", function () {
  it("creates and updates a session", function () {
    const registry = new SessionRegistry();
    const created = registry.create("inst-1", { source: "N0CALL", destination: "REMOTE-1" });

    assert.ok(created.sessionId);
    assert.strictEqual(created.state, "connecting");
    assert.strictEqual(created.destinationCallsign, "REMOTE-1");

    const updated = registry.update("inst-1", created.sessionId, { state: "connected" });
    assert.strictEqual(updated.state, "connected");
  });

  it("rejects duplicate session IDs per instance", function () {
    const registry = new SessionRegistry();
    registry.create("inst-1", { sessionId: "sess-1" });

    assert.throws(function () {
      registry.create("inst-1", { sessionId: "sess-1" });
    }, /SESSION_ID_CONFLICT/);
  });

  it("supports server session ID lookup", function () {
    const registry = new SessionRegistry();
    const created = registry.create("inst-1", { sessionId: "sess-1" });

    const bind = registry.bindServerSessionId("inst-1", created.sessionId, 123);
    assert.strictEqual(bind.collision, false);

    const found = registry.resolveByServerSessionId("inst-1", 123);
    assert.strictEqual(found.sessionId, "sess-1");
  });
});
