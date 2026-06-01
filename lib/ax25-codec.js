"use strict";

function classifyControl(control) {
  if ((control & 0x01) === 0) {
    return "I";
  }
  if ((control & 0x03) === 0x01) {
    return "S";
  }
  return "U";
}

function decodeAddress(buffer) {
  return buffer.toString("ascii");
}

function parseCallsign(input) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) {
    throw new Error("INVALID_CALLSIGN");
  }

  const parts = raw.split("-");
  const call = String(parts[0] || "").trim();
  if (!call) {
    throw new Error("INVALID_CALLSIGN");
  }

  const ssid = parts.length > 1 ? Number.parseInt(parts[1], 10) : 0;
  if (!Number.isInteger(ssid) || ssid < 0 || ssid > 15) {
    throw new Error("INVALID_SSID");
  }

  return {
    call,
    ssid
  };
}

function encodeAx25Address(callsign, options) {
  const opts = options || {};
  const parsed = parseCallsign(callsign);
  const call = parsed.call.slice(0, 6).padEnd(6, " ");

  const out = Buffer.alloc(7);
  for (let i = 0; i < 6; i++) {
    out[i] = call.charCodeAt(i) << 1;
  }

  // Base AX.25 SSID field keeps reserved bits set.
  let ssidByte = 0x60 | ((parsed.ssid & 0x0f) << 1);
  if (opts.hasBeenRepeated) {
    ssidByte |= 0x80;
  }
  if (opts.isLast) {
    ssidByte |= 0x01;
  }
  out[6] = ssidByte;

  return out;
}

function normalizeVia(value) {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value === "string") {
    return [{ callsign: value, hasBeenRepeated: false }];
  }

  if (!Array.isArray(value)) {
    throw new Error("ENCODE_INVALID_VIA");
  }

  return value.map(function (entry) {
    if (typeof entry === "string") {
      return {
        callsign: entry,
        hasBeenRepeated: false
      };
    }

    if (!entry || typeof entry !== "object") {
      throw new Error("ENCODE_INVALID_VIA_ENTRY");
    }

    if (!entry.callsign) {
      throw new Error("ENCODE_VIA_CALLSIGN_REQUIRED");
    }

    return {
      callsign: entry.callsign,
      hasBeenRepeated: Boolean(entry.hasBeenRepeated)
    };
  });
}

/**
 * Decode one AX.25 wire address field (7 bytes).
 *
 * Layout:
 *  - bytes 0..5: callsign characters shifted left by 1
 *  - byte 6: SSID/flags
 */
function decodeAx25Address(buffer) {
  if (buffer.length < 7) {
    throw new Error("INVALID_ADDRESS_LEN");
  }

  let call = "";
  for (let i = 0; i < 6; i++) {
    call += String.fromCharCode(buffer[i] >> 1);
  }
  call = call.trim();

  const ssidByte = buffer[6];
  const ssid = (ssidByte >> 1) & 0x0f;
  const hasBeenRepeated = (ssidByte & 0x80) !== 0;
  const isLast = (ssidByte & 0x01) !== 0;

  const callsign = ssid > 0 ? `${call}-${ssid}` : call;
  return {
    callsign,
    call,
    ssid,
    hasBeenRepeated,
    isLast,
    raw: Buffer.from(buffer)
  };
}

/**
 * Try to detect if buffer is AX.25 wire format or codec format.
 * Codec format starts with short destination length.
 * AX.25 wire address first byte is shifted callsign char, usually >= 0x60.
 * Some AGWPE K payloads may include a leading 0x00 before address bytes.
 */
function isWireFormat(buffer) {
  if (buffer.length < 15) {
    return false;
  }

  const firstByte = buffer.readUInt8(0);

  // Legacy compact codec format starts with short destination length.
  if (firstByte > 0 && firstByte <= 10) {
    return false;
  }

  // Standard AX.25 shifted chars are typically >= 0x60.
  if (firstByte >= 0x60) {
    return true;
  }

  // AGWPE K payloads are sometimes observed with a leading 0x00 byte.
  if (firstByte === 0x00 && buffer.length >= 16 && buffer.readUInt8(1) >= 0x60) {
    return true;
  }

  return false;
}

function hasPidField(control) {
  // I-frames always carry PID.
  if ((control & 0x01) === 0) {
    return true;
  }

  // U-frames: UI (0x03 with optional P/F bit 0x10) carries PID.
  if ((control & 0x03) === 0x03) {
    return (control & 0xef) === 0x03;
  }

  // S-frames do not carry PID.
  return false;
}

function parseAddressChain(buffer, offset) {
  const addresses = [];
  let cursor = offset;

  while (cursor + 7 <= buffer.length) {
    const decoded = decodeAx25Address(buffer.subarray(cursor, cursor + 7));
    addresses.push(decoded);
    cursor += 7;
    if (decoded.isLast) {
      break;
    }
  }

  if (addresses.length < 2) {
    throw new Error("AX25_ADDRESS_CHAIN_TOO_SHORT");
  }
  if (!addresses[addresses.length - 1].isLast) {
    throw new Error("AX25_ADDRESS_CHAIN_NOT_TERMINATED");
  }

  return {
    addresses,
    nextOffset: cursor
  };
}

/**
 * Decode real AX.25 wire format frame.
 * Structure:
 *  - destination (7)
 *  - source (7)
 *  - 0..N via addresses (7 each)
 *  - control (1)
 *  - optional PID (1)
 *  - information field
 */
function decodeWireAx25(raw) {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);
  if (buffer.length < 15) {
    throw new Error("AX25_FRAME_TOO_SHORT");
  }

  // Accept optional leading non-address byte seen in some AGWPE K payloads.
  const startOffset = buffer[0] >= 0x60 ? 0 : (buffer[0] === 0x00 && buffer[1] >= 0x60 ? 1 : 0);

  const chain = parseAddressChain(buffer, startOffset);
  if (chain.nextOffset >= buffer.length) {
    throw new Error("AX25_MISSING_CONTROL");
  }

  const control = buffer.readUInt8(chain.nextOffset);
  let cursor = chain.nextOffset + 1;

  let pid = null;
  if (hasPidField(control)) {
    if (cursor >= buffer.length) {
      throw new Error("AX25_MISSING_PID");
    }
    pid = buffer.readUInt8(cursor);
    cursor += 1;
  }

  const destinationAddr = chain.addresses[0];
  const sourceAddr = chain.addresses[1];
  const destination = destinationAddr.callsign;
  const source = sourceAddr.callsign;
  const destinationHasBeenRepeated = destinationAddr.hasBeenRepeated;
  const sourceHasBeenRepeated = sourceAddr.hasBeenRepeated;
  const via = chain.addresses.slice(2).map(function (entry) {
    return {
      callsign: entry.callsign,
      hasBeenRepeated: entry.hasBeenRepeated
    };
  });

  const payload = buffer.subarray(cursor);

  return {
    source,
    destination,
    sourceHasBeenRepeated,
    destinationHasBeenRepeated,
    via,
    control,
    pid,
    frameType: classifyControl(control),
    payload
  };
}

function encode(frame) {
  if (!frame || !frame.source || !frame.destination || frame.control === undefined) {
    throw new Error("ENCODE_INVALID_INPUT");
  }

  const controlValue = Number(frame.control);
  if (!Number.isInteger(controlValue) || controlValue < 0 || controlValue > 255) {
    throw new Error("ENCODE_INVALID_CONTROL");
  }

  const via = normalizeVia(frame.via);

  const addresses = [];
  addresses.push(
    encodeAx25Address(frame.destination, {
      isLast: false,
      hasBeenRepeated: Boolean(frame.destinationHasBeenRepeated)
    })
  );

  // Source is last only when there are no via.
  addresses.push(
    encodeAx25Address(frame.source, {
      isLast: via.length === 0,
      hasBeenRepeated: Boolean(frame.sourceHasBeenRepeated)
    })
  );

  for (let i = 0; i < via.length; i++) {
    const viaEntry = via[i];
    addresses.push(
      encodeAx25Address(viaEntry.callsign, {
        isLast: i === via.length - 1,
        hasBeenRepeated: viaEntry.hasBeenRepeated
      })
    );
  }

  const control = Buffer.from([controlValue]);
  const payload = Buffer.isBuffer(frame.payload)
    ? frame.payload
    : Array.isArray(frame.payload)
      ? Buffer.from(frame.payload)
      : Buffer.from(frame.payload || "", "utf8");

  const parts = addresses.concat([control]);
  if (hasPidField(controlValue)) {
    const pidValue = frame.pid === undefined || frame.pid === null ? 0xf0 : Number(frame.pid);
    if (!Number.isInteger(pidValue) || pidValue < 0 || pidValue > 255) {
      throw new Error("ENCODE_INVALID_PID");
    }
    parts.push(Buffer.from([pidValue]));
  }
  parts.push(payload);

  return Buffer.concat(parts);
}

function decode(raw) {
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw || []);

  // Auto-detect format: codec format vs wire format
  if (isWireFormat(buffer)) {
    return decodeWireAx25(buffer);
  }

  // Codec format (length-prefixed)
  if (buffer.length < 4) {
    throw new Error("DECODE_TOO_SHORT");
  }

  const destinationLen = buffer.readUInt8(0);
  const destinationStart = 1;
  const destinationEnd = destinationStart + destinationLen;
  const sourceLenPos = destinationEnd;

  if (buffer.length < sourceLenPos + 1) {
    throw new Error("DECODE_INVALID_DEST");
  }

  const sourceLen = buffer.readUInt8(sourceLenPos);
  const sourceStart = sourceLenPos + 1;
  const sourceEnd = sourceStart + sourceLen;
  const controlPos = sourceEnd;
  const pidPos = controlPos + 1;
  const payloadPos = pidPos + 1;

  if (buffer.length < payloadPos) {
    throw new Error("DECODE_INVALID_SOURCE");
  }

  const destination = decodeAddress(buffer.subarray(destinationStart, destinationEnd));
  const source = decodeAddress(buffer.subarray(sourceStart, sourceEnd));
  const control = buffer.readUInt8(controlPos);
  const pid = buffer.readUInt8(pidPos);
  const payload = buffer.subarray(payloadPos);

  return {
    source,
    destination,
    control,
    pid,
    frameType: classifyControl(control),
    payload
  };
}

module.exports = {
  encode,
  decode,
  decodeWireAx25,
  decodeAx25Address,
  classifyControl
};
