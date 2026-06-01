"use strict";

const assert = require("assert");
const { prettyPrintAgwpeFrame } = require("../../lib/agwpe-frame-pretty");
const { buildAgwpeFrame } = require("../../lib/agwpe-frame-builder");

describe("agwpe-frame-pretty", function () {
  it("pretty prints AGWPE buffer frames with decoded header fields", function () {
    const wire = buildAgwpeFrame({
      kind: "U",
      port: 1,
      pid: 0xf0,
      from: "N0CALL",
      to: "APRS",
      payload: Buffer.from("hello")
    });
    const output = prettyPrintAgwpeFrame(wire, { direction: "rx" });

    assert.match(output, /AGWPE frame rx buffer/);
    assert.match(output, /len=41/);
    assert.match(output, /port=1/);
    assert.match(output, /dataKind=U\(0x55\)/);
    assert.match(output, /pid=0xf0/);
    assert.match(output, /from=N0CALL/);
    assert.match(output, /to=APRS/);
    assert.match(output, /dataLen=5/);
    assert.match(output, /payloadAvailable=5/);
    assert.match(output, /complete=true/);
    assert.match(output, /payloadAscii=hello/);
  });

  it("pretty prints short non-header buffers with hex/ascii preview", function () {
    const output = prettyPrintAgwpeFrame(Buffer.from("hello"), { direction: "rx" });

    assert.match(output, /AGWPE frame rx buffer/);
    assert.match(output, /len=5/);
    assert.match(output, /hex=68 65 6c 6c 6f/);
    assert.match(output, /ascii=hello/);
  });

  it("pretty prints object frames with important routing fields", function () {
    const output = prettyPrintAgwpeFrame(
      {
        kind: "connected",
        sessionId: "s1",
        source: "N0CALL",
        destination: "CQ",
        event: "connected",
        payload: "test payload"
      },
      { direction: "route" }
    );

    assert.match(output, /AGWPE frame route/);
    assert.match(output, /kind=connected/);
    assert.match(output, /sessionId=s1/);
    assert.match(output, /source=N0CALL/);
    assert.match(output, /destination=CQ/);
    assert.match(output, /event=connected/);
    assert.match(output, /payload="test payload"/);
  });

  it("handles invalid frame values", function () {
    const output = prettyPrintAgwpeFrame(null, { direction: "tx" });

    assert.match(output, /AGWPE frame tx invalid=null/);
  });
});