"use strict";

const DEFAULT_CHUNK_SIZE = 255;

function toBuffer(payload) {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }
  if (typeof payload === "string") {
    return Buffer.from(payload, "utf8");
  }
  if (payload === undefined || payload === null) {
    return Buffer.alloc(0);
  }
  throw new TypeError("payload must be a string or Buffer");
}

function splitPayload(payload, chunkSize) {
  const size = Number.isInteger(chunkSize) && chunkSize > 0 ? chunkSize : DEFAULT_CHUNK_SIZE;
  const buffer = toBuffer(payload);

  if (buffer.length === 0) {
    return [Buffer.alloc(0)];
  }

  const chunks = [];
  for (let index = 0; index < buffer.length; index += size) {
    chunks.push(buffer.subarray(index, index + size));
  }
  return chunks;
}

function buildChunkMetadata(payload, options) {
  const opts = options || {};
  const messageId = opts.messageId;
  const chunks = splitPayload(payload, opts.chunkSize);
  const chunkCount = chunks.length;

  return chunks.map(function (chunk, chunkIndex) {
    return {
      messageId,
      chunkIndex,
      chunkCount,
      payload: chunk
    };
  });
}

module.exports = {
  DEFAULT_CHUNK_SIZE,
  splitPayload,
  buildChunkMetadata
};
