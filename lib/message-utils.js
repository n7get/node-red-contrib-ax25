"use strict";

const crypto = require("crypto");

function nowTimestamp() {
  return new Date().toISOString();
}

function makeMessageId(prefix) {
  const head = prefix || "msg";
  return head + "-" + crypto.randomUUID();
}

function okEnvelope(fields) {
  return Object.assign(
    {
      timestamp: nowTimestamp(),
      status: "ok"
    },
    fields || {}
  );
}

function errorEnvelope(errorCode, errorText, fields) {
  return Object.assign(
    {
      timestamp: nowTimestamp(),
      status: "error",
      errorCode,
      errorText
    },
    fields || {}
  );
}

function chunkEnvelope(fields) {
  const data = Object.assign({ timestamp: nowTimestamp() }, fields || {});
  if (!Number.isInteger(data.chunkIndex) || data.chunkIndex < 0) {
    throw new Error("chunkIndex must be a non-negative integer");
  }
  if (!Number.isInteger(data.chunkCount) || data.chunkCount < 1) {
    throw new Error("chunkCount must be a positive integer");
  }
  if (data.chunkIndex >= data.chunkCount) {
    throw new Error("chunkIndex must be less than chunkCount");
  }
  if (!data.messageId) {
    throw new Error("messageId is required");
  }
  return data;
}

module.exports = {
  nowTimestamp,
  makeMessageId,
  okEnvelope,
  errorEnvelope,
  chunkEnvelope
};
