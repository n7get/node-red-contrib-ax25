"use strict";

const assert = require("assert");
const codec = require("../../lib/ax25-codec");

describe("ax25-codec wire format decode", function () {
  it("decodes a single character address field", function () {
    // Create a minimal buffer with just a destination address
    // Using explicit hex values: C=0x43, shifted left 1 = 0x86
    const buffer = Buffer.from([0x86, 0xa2, 0x40, 0x40, 0x40, 0x40, 0x00]);
    // 0x86 >> 1 = 0x43 = 'C'
    // 0xa2 >> 1 = 0x51 = 'Q'
    // 0x40 >> 1 = 0x20 = ' '

    const decoded = codec.decodeAx25Address(buffer);
    assert.strictEqual(decoded.callsign, "CQ", "Should decode to CQ but got: " + JSON.stringify(decoded));
    assert.strictEqual(decoded.isLast, false);
  });

  it("decodes wire format frame", function () {
    // Destination: CQ + padding
    // C = 0x43 << 1 = 0x86
    // Q = 0x51 << 1 = 0xa2
    // space = 0x20 << 1 = 0x40
    const dest = Buffer.from([0x86, 0xa2, 0x40, 0x40, 0x40, 0x40, 0x00]);

    // Source: N0 + padding
    // N = 0x4e << 1 = 0x9c
    // 0 = 0x30 << 1 = 0x60
    // space = 0x20 << 1 = 0x40
    const src = Buffer.from([0x9c, 0x60, 0x40, 0x40, 0x40, 0x40, 0x01]);

    const frame = Buffer.concat([dest, src, Buffer.from([0x03, 0xf0]), Buffer.from("test")]);
    const decoded = codec.decodeWireAx25(frame);

    assert.strictEqual(decoded.destination, "CQ");
    assert.strictEqual(decoded.source, "N0");
    assert.strictEqual(decoded.control, 0x03);
    assert.strictEqual(decoded.pid, 0xf0);
    assert.strictEqual(decoded.payload.toString("ascii"), "test");
    assert.deepStrictEqual(decoded.via, []);
  });

  it("decodes K-frame payload with via and leading byte", function () {
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
    assert.strictEqual(decoded.destination, "APAGW");
    assert.strictEqual(decoded.source, "W0SX-2");
    assert.strictEqual(decoded.frameType, "U");
    assert.strictEqual(decoded.control, 0x03);
    assert.strictEqual(decoded.pid, 0xf0);
    assert.strictEqual(decoded.payload.toString("ascii"), ">");
    assert.strictEqual(decoded.via.length, 3);
    assert.strictEqual(decoded.via[0].callsign, "UTAH");
    assert.strictEqual(decoded.via[1].callsign, "VEGAS");
    assert.strictEqual(decoded.via[2].callsign, "WIDE2");
    assert.strictEqual(typeof decoded.via[0].hasBeenRepeated, "boolean");
  });
});
