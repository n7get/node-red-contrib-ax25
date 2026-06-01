"use strict";

const assert = require("assert");
const { validateConfig } = require("../../nodes/agwpe-client")._internal;

describe("contract: agwpe-client config validation", function () {
  it("accepts valid host and integer port", function () {
    assert.strictEqual(validateConfig({ host: "127.0.0.1", port: 8000 }), null);
  });

  it("rejects missing host", function () {
    assert.strictEqual(validateConfig({ host: "", port: 8000 }), "CONNECT_REQUIRES_HOST");
    assert.strictEqual(validateConfig({ port: 8000 }), "CONNECT_REQUIRES_HOST");
  });

  it("rejects non-integer port", function () {
    assert.strictEqual(validateConfig({ host: "127.0.0.1", port: "8000" }), "CONNECT_REQUIRES_PORT");
    assert.strictEqual(validateConfig({ host: "127.0.0.1", port: 8000.5 }), "CONNECT_REQUIRES_PORT");
    assert.strictEqual(validateConfig({ host: "127.0.0.1" }), "CONNECT_REQUIRES_PORT");
  });
});
