"use strict";

const net = require("net");
const EventEmitter = require("events");
const { prettyPrintAgwpeFrame } = require("./agwpe-frame-pretty");

class AgwpeClientTransport extends EventEmitter {
  constructor(options) {
    super();
    const opts = options || {};
    this.socketFactory = opts.socketFactory || net.createConnection;
    this.logger = opts.logger || function () {};
    this.socket = null;
    this.state = "disconnected";
  }

  open(host, port, callback) {
    const done = typeof callback === "function" ? callback : function () {};
    if (this.state === "connecting" || this.state === "connected") {
      done(new Error("TRANSPORT_ALREADY_OPEN"));
      return;
    }

    this.state = "connecting";
    this.logger(`AGWPE transport connecting to ${host}:${port}`);
    const socket = this.socketFactory({ host, port });
    socket.setKeepAlive(true, 10000);
    this.socket = socket;

    socket.on("connect", () => {
      this.state = "connected";
      this.logger(`AGWPE transport connected to ${host}:${port}`);
      this.emit("connected");
      done(null);
    });

    socket.on("data", (data) => {
      this.logger(prettyPrintAgwpeFrame(data, { direction: "rx" }));
      this.emit("frame", data);
    });

    socket.on("error", (error) => {
      this.state = "failed";
      this.logger(`AGWPE transport error: ${error.message}`);
      this.emit("error", error);
    });

    socket.on("close", () => {
      this.state = "disconnected";
      this.logger(`AGWPE transport closed`);
      this.emit("closed");
    });
  }

  sendFrame(frame, callback) {
    const done = typeof callback === "function" ? callback : function () {};
    if (!this.socket || this.state !== "connected") {
      done(new Error("TRANSPORT_NOT_CONNECTED"));
      return;
    }
    this.logger(prettyPrintAgwpeFrame(frame, { direction: "tx" }));
    this.socket.write(frame, done);
  }

  close(callback) {
    const done = typeof callback === "function" ? callback : function () {};
    if (!this.socket) {
      this.state = "disconnected";
      done(null);
      return;
    }

    const socket = this.socket;
    this.socket = null;
    this.state = "closing";
    this.logger(`AGWPE transport closing`);

    if (socket.destroyed) {
      this.state = "disconnected";
      this.logger(`AGWPE transport closed`);
      done(null);
      return;
    }

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      this.state = "disconnected";
      this.logger(`AGWPE transport closed`);
      done(null);
    };

    socket.once("close", settle);
    socket.end(settle);
  }
}

module.exports = AgwpeClientTransport;
