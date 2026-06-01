"use strict";

const assert = require("assert");
const {
  buildAgwpeFrame,
  makeRegistrationFrame,
  makeConnectFrame,
  makeViaConnectFrame,
  makeDisconnectFrame,
  makeDataFrame,
  makeUiFrame,
  makeRawFrame,
  makeMonitorToggleFrame,
  makeRawToggleFrame,
  makeOutstandingQueryFrame
} = require("../../lib/agwpe-frame-builder");

describe("agwpe-frame-builder", function () {
  it("matches AGWPEAPI sample bytes for X registration header", function () {
    const frame = makeRegistrationFrame("LU7DID-4");
    const expectedHeader = Buffer.from(
      "00 00 00 00 58 00 00 00 4c 55 37 44 49 44 2d 34 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00".replace(/ /g, ""),
      "hex"
    );

    assert.ok(frame.subarray(0, 36).equals(expectedHeader));
  });

  it("matches AGWPEAPI sample bytes for M unproto header", function () {
    const payload = Buffer.alloc(0x39);
    const frame = makeUiFrame("LU7DID-4", "NETME", payload);
    const expectedHeader = Buffer.from(
      "00 00 00 00 4d 00 f0 00 4c 55 37 44 49 44 2d 34 00 00 4e 45 54 4d 45 00 00 00 00 00 39 00 00 00 00 00 00 00".replace(/ /g, ""),
      "hex"
    );

    assert.ok(frame.subarray(0, 36).equals(expectedHeader));
  });

  it("matches AGWPEAPI sample bytes for C connect header", function () {
    const frame = buildAgwpeFrame({ kind: "C", port: 1, from: "LU7DID-4", to: "LU7DID" });
    const expectedHeader = Buffer.from(
      "01 00 00 00 43 00 00 00 4c 55 37 44 49 44 2d 34 00 00 4c 55 37 44 49 44 00 00 00 00 00 00 00 00 00 00 00 00".replace(/ /g, ""),
      "hex"
    );

    assert.ok(frame.subarray(0, 36).equals(expectedHeader));
  });

  it("matches AGWPEAPI sample bytes for d disconnect header", function () {
    const frame = buildAgwpeFrame({ kind: "d", port: 1, from: "LU7DID-4", to: "LU7DID" });
    const expectedHeader = Buffer.from(
      "01 00 00 00 64 00 00 00 4c 55 37 44 49 44 2d 34 00 00 4c 55 37 44 49 44 00 00 00 00 00 00 00 00 00 00 00 00".replace(/ /g, ""),
      "hex"
    );

    assert.ok(frame.subarray(0, 36).equals(expectedHeader));
  });

  it("builds X registration with callsign at byte 8 and length at byte 28", function () {
    const frame = makeRegistrationFrame("N0CALL");

    assert.strictEqual(frame.length, 36);
    assert.strictEqual(frame.readUInt8(4), "X".charCodeAt(0));
    assert.strictEqual(frame.readUInt8(6), 0);
    assert.strictEqual(frame.toString("ascii", 8, 14), "N0CALL");
    assert.strictEqual(frame.readUInt32LE(28), 0);
    assert.strictEqual(frame.readUInt32LE(32), 0);
  });

  it("builds C connect with source and destination fields", function () {
    const frame = makeConnectFrame("N0CALL", "REMOTE");

    assert.strictEqual(frame.readUInt8(4), "C".charCodeAt(0));
    assert.strictEqual(frame.toString("ascii", 8, 14), "N0CALL");
    assert.strictEqual(frame.toString("ascii", 18, 24), "REMOTE");
    assert.strictEqual(frame.readUInt32LE(28), 0);
  });

  it("builds D data with PID 0xF0 and payload after 36-byte header", function () {
    const payload = Buffer.from("hello", "utf8");
    const frame = makeDataFrame("N0CALL", "REMOTE", payload);

    assert.strictEqual(frame.readUInt8(4), "D".charCodeAt(0));
    assert.strictEqual(frame.readUInt8(6), 0xf0);
    assert.strictEqual(frame.readUInt32LE(28), payload.length);
    assert.strictEqual(frame.toString("utf8", 36), "hello");
  });

  it("builds M UI with PID 0xF0 and payload after 36-byte header", function () {
    const payload = Buffer.from("beacon", "utf8");
    const frame = makeUiFrame("N0CALL", "CQ", payload);

    assert.strictEqual(frame.readUInt8(4), "M".charCodeAt(0));
    assert.strictEqual(frame.readUInt8(6), 0xf0);
    assert.strictEqual(frame.readUInt32LE(28), payload.length);
    assert.strictEqual(frame.toString("utf8", 36), "beacon");
  });

  it("builds K raw frame with payload after 36-byte header", function () {
    const payload = Buffer.from([0x82, 0xa0, 0xa8]);
    const frame = makeRawFrame("N0CALL", "CQ", payload);

    assert.strictEqual(frame.readUInt8(4), "K".charCodeAt(0));
    assert.strictEqual(frame.readUInt8(6), 0x00);
    assert.strictEqual(frame.readUInt32LE(28), payload.length);
    assert.strictEqual(frame.subarray(36).toString("hex"), payload.toString("hex"));
  });

  it("builds m monitor toggle as header-only frame", function () {
    const frame = makeMonitorToggleFrame();

    assert.strictEqual(frame.length, 36);
    assert.strictEqual(frame.readUInt8(4), "m".charCodeAt(0));
    assert.strictEqual(frame.readUInt32LE(28), 0);
  });

  it("builds k raw toggle as header-only frame", function () {
    const frame = makeRawToggleFrame();

    assert.strictEqual(frame.length, 36);
    assert.strictEqual(frame.readUInt8(4), "k".charCodeAt(0));
    assert.strictEqual(frame.readUInt32LE(28), 0);
  });

  it("builds v connect-via frame with leading count byte then callsigns", function () {
    const frame = makeViaConnectFrame("N0CALL", "REMOTE", ["WIDE1-1", "WIDE2-2"]);

    assert.strictEqual(frame.readUInt8(4), "v".charCodeAt(0));
    assert.strictEqual(frame.toString("ascii", 8, 14), "N0CALL");
    assert.strictEqual(frame.toString("ascii", 18, 24), "REMOTE");
    // DataLen = 1 (count) + 2 * 10 (callsigns) = 21
    assert.strictEqual(frame.readUInt32LE(28), 21);
    // payload[0] = via count
    assert.strictEqual(frame[36], 2);
    // payload[1..10] = "WIDE1-1" null-padded
    assert.strictEqual(frame.subarray(37, 44).toString("ascii"), "WIDE1-1");
    assert.strictEqual(frame[44], 0x00);
    // payload[11..20] = "WIDE2-2" null-padded
    assert.strictEqual(frame.subarray(47, 54).toString("ascii"), "WIDE2-2");
  });

  it("builds v connect-via frame with one via station", function () {
    const frame = makeViaConnectFrame("N0CALL", "N1CALL-1", ["WIDE1-1"]);

    assert.strictEqual(frame.readUInt8(4), "v".charCodeAt(0));
    assert.strictEqual(frame.readUInt32LE(28), 11); // 1 + 10
    assert.strictEqual(frame[36], 1);
    assert.strictEqual(frame.subarray(37, 44).toString("ascii"), "WIDE1-1");
  });

  it("builds y outstanding-query as header-only frame with source and destination", function () {
    const frame = makeOutstandingQueryFrame("N0CALL", "REMOTE");

    assert.strictEqual(frame.length, 36);
    assert.strictEqual(frame.readUInt8(4), "y".charCodeAt(0));
    assert.strictEqual(frame.readUInt8(6), 0x00);
    assert.strictEqual(frame.toString("ascii", 8, 14), "N0CALL");
    assert.strictEqual(frame.toString("ascii", 18, 24), "REMOTE");
    assert.strictEqual(frame.readUInt32LE(28), 0);
  });
});
