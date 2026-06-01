"use strict";

const assert = require("assert");
const codec = require("../../lib/ax25-codec");

describe("integration: encode roundtrip", function () {
  it("round trips encode/decode fields", function () {
    const encoded = codec.encode({
      source: "N0CALL",
      destination: "CQ",
      control: 0x03,
      pid: 0xf0,
      payload: "hello"
    });

    const decoded = codec.decode(encoded);
    assert.strictEqual(decoded.source, "N0CALL");
    assert.strictEqual(decoded.destination, "CQ");
    assert.strictEqual(decoded.payload.toString("utf8"), "hello");
  });

  it("decodes real AX.25 wire format frames", function () {
    // Build wire format frame using explicit hex values
    // Destination: CQ + padding
    // C = 0x43 << 1 = 0x86, Q = 0x51 << 1 = 0xa2, space = 0x20 << 1 = 0x40
    const dest = Buffer.from([0x86, 0xa2, 0x40, 0x40, 0x40, 0x40, 0x00]);

    // Source: N0 + padding  
    // N = 0x4e << 1 = 0x9c, 0 = 0x30 << 1 = 0x60
    const src = Buffer.from([0x9c, 0x60, 0x40, 0x40, 0x40, 0x40, 0x01]);

    const frame = Buffer.concat([dest, src, Buffer.from([0x03, 0xf0]), Buffer.from("test")]);
    const decoded = codec.decodeWireAx25(frame);

    assert.strictEqual(decoded.destination, "CQ", "destination should be CQ but got " + decoded.destination);
    assert.strictEqual(decoded.source, "N0", "source should be N0 but got " + decoded.source);
    assert.strictEqual(decoded.control, 0x03);
    assert.strictEqual(decoded.pid, 0xf0);
    assert.strictEqual(decoded.payload.toString("ascii"), "test");
  });

  it("round trips decode output back into raw AX.25", function () {
    const rawPayload = Buffer.from([
      0x00,
      0x82, 0xa0, 0x82, 0x8e, 0xae, 0x40, 0x60,
      0xae, 0x60, 0xa6, 0xb0, 0x40, 0x40, 0x64,
      0xaa, 0xa8, 0x82, 0x90, 0x40, 0x40, 0xe0,
      0xac, 0x8a, 0x8e, 0x82, 0xa6, 0x40, 0xe0,
      0xae, 0x92, 0x88, 0x8a, 0x64, 0x40, 0xe1,
      0x03, 0xf0, 0x3e
    ]);

    const decoded = codec.decode(rawPayload);
    const reEncoded = codec.encode(decoded);
    const decodedAgain = codec.decode(reEncoded);

    assert.strictEqual(decodedAgain.destination, decoded.destination);
    assert.strictEqual(decodedAgain.source, decoded.source);
    assert.strictEqual(decodedAgain.destinationHasBeenRepeated, decoded.destinationHasBeenRepeated);
    assert.strictEqual(decodedAgain.sourceHasBeenRepeated, decoded.sourceHasBeenRepeated);
    assert.strictEqual(decodedAgain.control, decoded.control);
    assert.strictEqual(decodedAgain.pid, decoded.pid);
    assert.strictEqual(decodedAgain.payload.toString("hex"), decoded.payload.toString("hex"));
    assert.deepStrictEqual(decodedAgain.via, decoded.via);

    // Re-encoded bytes must be identical to the original wire bytes (minus the 0x00 pad byte).
    assert.strictEqual(reEncoded.toString("hex"), rawPayload.subarray(1).toString("hex"));
  });

  it("preserves H bit (hasBeenRepeated) on destination and source through round trip", function () {
    // Mirrors real APRS K-frame: destination and source both have bit 7 (H) set.
    // Destination: "APT311" with H=1 → SSID byte = 0x60 | 0x80 = 0xE0
    // Source: "WB6QDI-9" with H=1, SSID=9, not last → 0x60 | 0x80 | (9 << 1) = 0xF2
    const dest = Buffer.from([
      0x82, 0xa0, 0xa8, 0x66, 0x62, 0x62,   // "APT311" shifted left 1
      0xe0                                    // H=1, SSID=0, not last
    ]);
    const src = Buffer.from([
      0xae, 0x84, 0x6c, 0xa2, 0x88, 0x92,   // "WB6QDI" shifted left 1
      0xf2                                    // H=1, SSID=9 (0x12 << 1 = 0x24, | 0x60 | 0x80 = 0xF4... let's use simpler SSID=1)
    ]);
    // Use SSID=1 for source: 0x60 | 0x80 | (1 << 1) = 0xE2, not last → 0xE2
    src[6] = 0xe2; // H=1, SSID=1, not last
    const digi = Buffer.from([
      0xac, 0x8a, 0x8e, 0x82, 0xa6, 0x40,   // "WIDE1" shifted left 1
      0xe1                                    // H=1, SSID=0, isLast
    ]);
    const wireFrame = Buffer.concat([dest, src, digi, Buffer.from([0x03, 0xf0]), Buffer.from("test")]);

    const decoded = codec.decodeWireAx25(wireFrame);
    assert.strictEqual(decoded.destinationHasBeenRepeated, true);
    assert.strictEqual(decoded.sourceHasBeenRepeated, true);

    const reEncoded = codec.encode(decoded);
    assert.strictEqual(reEncoded.toString("hex"), wireFrame.toString("hex"), "re-encoded bytes must be identical to original");
  });

  it("accepts via as single string", function () {
    const encoded = codec.encode({
      source: "N0CALL",
      destination: "APRS",
      via: "WIDE1-1",
      control: 0x03,
      pid: 0xf0,
      payload: "hi"
    });

    const decoded = codec.decode(encoded);
    assert.strictEqual(decoded.via.length, 1);
    assert.strictEqual(decoded.via[0].callsign, "WIDE1-1");
    assert.strictEqual(decoded.via[0].hasBeenRepeated, false);
  });

  it("accepts via as array of strings", function () {
    const encoded = codec.encode({
      source: "N0CALL",
      destination: "APRS",
      via: ["WIDE1-1", "WIDE2-2"],
      control: 0x03,
      pid: 0xf0,
      payload: "hi"
    });

    const decoded = codec.decode(encoded);
    assert.strictEqual(decoded.via.length, 2);
    assert.strictEqual(decoded.via[0].callsign, "WIDE1-1");
    assert.strictEqual(decoded.via[1].callsign, "WIDE2-2");
  });

  it("accepts via as array of objects", function () {
    const encoded = codec.encode({
      source: "N0CALL",
      destination: "APRS",
      via: [
        { callsign: "WIDE1-1", hasBeenRepeated: true },
        { callsign: "WIDE2-2", hasBeenRepeated: false }
      ],
      control: 0x03,
      pid: 0xf0,
      payload: "hi"
    });

    const decoded = codec.decode(encoded);
    assert.strictEqual(decoded.via.length, 2);
    assert.strictEqual(decoded.via[0].callsign, "WIDE1-1");
    assert.strictEqual(decoded.via[0].hasBeenRepeated, true);
    assert.strictEqual(decoded.via[1].callsign, "WIDE2-2");
    assert.strictEqual(decoded.via[1].hasBeenRepeated, false);
  });
});
