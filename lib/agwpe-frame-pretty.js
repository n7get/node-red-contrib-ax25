"use strict";

const AGWPE_HEADER_LEN = 36;

function toHexPreview(buffer, maxBytes) {
  const limit = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : 32;
  const view = buffer.subarray(0, limit);
  const hex = view.toString("hex");
  return hex.match(/.{1,2}/g)?.join(" ") || "";
}

function toAsciiPreview(buffer, maxBytes) {
  const limit = Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : 32;
  const view = buffer.subarray(0, limit);
  return view
    .toString("utf8")
    .replace(/[\x00-\x1F\x7F]/g, ".");
}

function decodeCallsign(buffer, offset) {
  const raw = buffer.subarray(offset, offset + 10);
  const nul = raw.indexOf(0x00);
  const end = nul >= 0 ? nul : raw.length;
  return raw.subarray(0, end).toString("ascii").trim();
}

function toDataKindChar(byteValue) {
  if (byteValue >= 32 && byteValue <= 126) {
    return String.fromCharCode(byteValue);
  }
  return "?";
}

function prettyPrintAgwpeFrame(frame, options) {
  const opts = options || {};
  const direction = opts.direction ? String(opts.direction) : "?";

  if (Buffer.isBuffer(frame)) {
    const parts = [
      `AGWPE frame ${direction} buffer`,
      `len=${frame.length}`
    ];

    if (frame.length >= AGWPE_HEADER_LEN) {
      const dataKindByte = frame.readUInt8(4);
      const dataLen = frame.readUInt32LE(28);
      const payloadAvailable = Math.max(0, frame.length - AGWPE_HEADER_LEN);
      const payloadExtractLen = Math.min(dataLen, payloadAvailable);
      const payload = frame.subarray(AGWPE_HEADER_LEN, AGWPE_HEADER_LEN + payloadExtractLen);

      parts.push(`port=${frame.readUInt8(0)}`);
      parts.push(`dataKind=${toDataKindChar(dataKindByte)}(0x${dataKindByte.toString(16).padStart(2, "0")})`);
      parts.push(`pid=0x${frame.readUInt8(6).toString(16).padStart(2, "0")}`);
      parts.push(`from=${decodeCallsign(frame, 8) || "-"}`);
      parts.push(`to=${decodeCallsign(frame, 18) || "-"}`);
      parts.push(`dataLen=${dataLen}`);
      parts.push(`user=${frame.readUInt32LE(32)}`);
      parts.push(`payloadAvailable=${payloadAvailable}`);
      parts.push(`complete=${payloadAvailable >= dataLen}`);

      if (payloadExtractLen > 0) {
        parts.push(`payloadHex=${toHexPreview(payload, opts.maxPreviewBytes)}`);
        parts.push(`payloadAscii=${toAsciiPreview(payload, opts.maxPreviewBytes)}`);
      }
    } else {
      parts.push(`hex=${toHexPreview(frame, opts.maxPreviewBytes)}`);
      parts.push(`ascii=${toAsciiPreview(frame, opts.maxPreviewBytes)}`);
    }

    return parts.join(" | ");
  }

  if (!frame || typeof frame !== "object") {
    return `AGWPE frame ${direction} invalid=${String(frame)}`;
  }

  const parts = [
    `AGWPE frame ${direction}`,
    `kind=${frame.kind || "unknown"}`
  ];

  if (frame.sessionId !== undefined) {
    parts.push(`sessionId=${frame.sessionId}`);
  }
  if (frame.source) {
    parts.push(`source=${frame.source}`);
  }
  if (frame.destination) {
    parts.push(`destination=${frame.destination}`);
  }
  if (frame.event) {
    parts.push(`event=${frame.event}`);
  }

  if (Buffer.isBuffer(frame.payload)) {
    parts.push(`payloadLen=${frame.payload.length}`);
    parts.push(`payloadHex=${toHexPreview(frame.payload, opts.maxPreviewBytes)}`);
  } else if (typeof frame.payload === "string") {
    parts.push(`payload="${frame.payload.slice(0, 64)}${frame.payload.length > 64 ? "..." : ""}"`);
  }

  return parts.join(" | ");
}

module.exports = {
  prettyPrintAgwpeFrame
};