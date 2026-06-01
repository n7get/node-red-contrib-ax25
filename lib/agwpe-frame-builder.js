"use strict";

/**
 * AGWPE wire frame builder.
 *
 * All AGWPE frames share a 36-byte header:
 *   byte 0:     Port (0-based)
 *   bytes 1-3:  reserved
 *   byte 4:     DataKind (ASCII: 'X'=register, 'C'=connect, 'd'=disconnect, 'D'=data, 'M'=UI)
 *   byte 5:     reserved
 *   byte 6:     PID (typically 0xF0 for AX.25 UI/I payloads)
 *   byte 7:     reserved
 *   bytes 8-17: CallSign From (10 bytes, null-padded, uppercase ASCII)
 *   bytes 18-27:CallSign To   (10 bytes, null-padded, uppercase ASCII)
 *   bytes 28-31:DataLength    (uint32 LE) — length of data following header
 *   bytes 32-35:User/reserved (uint32 LE)
 *
 * Data payload (if any) follows immediately after the 36-byte header.
 */

const HEADER_LEN = 36;

function encodeCallsign(callsign) {
  const out = Buffer.alloc(10);
  const normalized = String(callsign || "")
    .trim()
    .toUpperCase()
    .slice(0, 9);
  Buffer.from(normalized, "ascii").copy(out, 0);
  return out;
}

/**
 * Build an AGWPE frame.
 *
 * @param {object} opts
 * @param {string} opts.kind       - DataKind character (e.g. 'C', 'D', 'd', 'M')
 * @param {string} [opts.from]     - Source callsign
 * @param {string} [opts.to]       - Destination callsign
 * @param {Buffer} [opts.payload]  - Data payload (appended after header)
 * @param {number} [opts.port]     - Port number (default 0)
 * @param {number} [opts.pid]      - AX.25 PID byte (default 0)
 * @param {number} [opts.user]     - User reserved field (default 0)
 * @returns {Buffer}
 */
function buildAgwpeFrame(opts) {
  const kind = String(opts.kind || "").charCodeAt(0);
  const payload = Buffer.isBuffer(opts.payload) ? opts.payload : Buffer.alloc(0);
  const frame = Buffer.alloc(HEADER_LEN + payload.length);

  frame.writeUInt8(opts.port || 0, 0);
  frame.writeUInt8(kind, 4);
  frame.writeUInt8(opts.pid || 0, 6);
  encodeCallsign(opts.from).copy(frame, 8);
  encodeCallsign(opts.to).copy(frame, 18);
  frame.writeUInt32LE(payload.length, 28);
  frame.writeUInt32LE(opts.user || 0, 32);

  if (payload.length > 0) {
    payload.copy(frame, HEADER_LEN);
  }

  return frame;
}

/**
 * Build a 'C' (connect) frame.
 */
function makeConnectFrame(source, destination) {
  return buildAgwpeFrame({ kind: "C", from: source, to: destination });
}

/**
 * Build a 'v' (connect via digipeaters) frame.
 *
 * The payload contains the digipeater callsigns, each encoded as 10 bytes
 * (null-padded uppercase ASCII), matching the AGWPE callsign field format.
 * DataLen = N * 10 where N is the number of via stations.
 *
 * @param {string}          source       - Our callsign.
 * @param {string}          destination  - Remote callsign.
 * @param {string[]|object[]} viaCallsigns - Digipeater callsigns (strings or
 *   objects with a .callsign property).
 * @returns {Buffer}
 */
function makeViaConnectFrame(source, destination, viaCallsigns) {
  const via = Array.isArray(viaCallsigns) ? viaCallsigns : [];
  const viaCount = Buffer.from([via.length & 0xff]);
  const viaBuffers = via.map(function (cs) {
    return encodeCallsign(typeof cs === "object" ? cs.callsign : cs);
  });
  const viaPayload = Buffer.concat([viaCount].concat(viaBuffers));
  return buildAgwpeFrame({ kind: "v", from: source, to: destination, payload: viaPayload });
}

/**
 * Build an 'X' (register callsign) frame.
 */
function makeRegistrationFrame(callsign) {
  return buildAgwpeFrame({ kind: "X", from: callsign });
}

/**
 * Build a 'd' (disconnect) frame.
 */
function makeDisconnectFrame(source, destination) {
  return buildAgwpeFrame({ kind: "d", from: source, to: destination });
}

/**
 * Build a 'D' (connected data) frame.
 */
function makeDataFrame(source, destination, payload) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload || "", "utf8");
  return buildAgwpeFrame({ kind: "D", from: source, to: destination, pid: 0xf0, payload: data });
}

/**
 * Build an 'M' (UI / unconnected) frame.
 */
function makeUiFrame(source, destination, payload) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload || "", "utf8");
  return buildAgwpeFrame({ kind: "M", from: source, to: destination, pid: 0xf0, payload: data });
}

/**
 * Build a 'K' (raw AX.25) frame.
 */
function makeRawFrame(source, destination, payload) {
  const data = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload || "", "utf8");
  return buildAgwpeFrame({ kind: "K", from: source, to: destination, payload: data });
}

/**
 * Build a 'y' (query outstanding frames) frame.
 * Asks the TNC how many unacknowledged I-frames are still pending for a
 * specific connected callsign pair.  The TNC replies with a 'Y' frame
 * whose DataLen field contains the outstanding count.
 */
function makeOutstandingQueryFrame(source, destination) {
  return buildAgwpeFrame({ kind: "y", from: source, to: destination });
}

/**
 * Build an 'm' command frame to toggle monitor traffic streaming.
 */
function makeMonitorToggleFrame() {
  return buildAgwpeFrame({ kind: "m" });
}

/**
 * Build a 'k' command frame to toggle raw frame streaming.
 */
function makeRawToggleFrame() {
  return buildAgwpeFrame({ kind: "k" });
}

module.exports = {
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
};
