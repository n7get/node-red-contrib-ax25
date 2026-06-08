# Project Context: node-red-contrib-ax25

## What this is

A Node-RED contrib package that enables AX.25 packet radio connectivity through an AGWPE (AGW Packet Engine) server. Radio amateurs use it to integrate packet radio into Node-RED flows — connecting to BBSs, digipeaters, and other AX.25 stations.

The package provides eleven custom nodes covering connected sessions, unconnected UI frames, monitor mode, raw frames, AX.25 encode/decode, and runtime control of the AGWPE connection.

## Target users

Radio amateurs and enthusiasts running Node-RED who want to interact with AX.25 packet radio networks without writing socket code.

## Runtime environment

- Node.js 20 LTS, CommonJS modules
- Node-RED 3.x+
- No external runtime dependencies (only Node.js `net` and `events`)

## Key design decisions

**Auto-reconnect is on by default.** When the AGWPE transport drops, all owned sessions are marked disconnected and the node automatically attempts to reconnect after a configurable delay (default 5000 ms). Auto-reconnect can be disabled via the "Auto-Reconnect" checkbox in the config editor. When disabled, all sessions fail and the flow must re-deploy or restart to reconnect.

**`agwpe-client` is a config node.** It does not receive messages directly. All static configuration (host, port, callsigns, auth, monitor/raw mode, reconnect settings) is set in the Node-RED editor. The connection is established automatically when the flow deploys. Runtime control (connect, disconnect, config updates, status query) is available via the `agwpe-control` node.

**Per-instance connection ownership.** Each `agwpe-client` node manages one AGWPE TCP connection. All downstream nodes (`conn-out`, `conn-in`, `ui-in`, `ui-out`, `monitor-in`, `raw-in`, `raw-out`) bind to a specific `agwpe-client` instance by `instanceId`. Cross-instance routing is not allowed.

**Inbound data follows the last active node.** Received data for a connected session is routed to whichever `connect` or `send` node most recently processed a command for that session. When a `send` node handles a command, it takes over the data output for that session; when the session is first established by `connect`, data goes to `connect`'s output. This lets flows chain request/response steps naturally: each node in the chain receives the reply to its own send.

**Binary and line modes.** The `connect` node's `mode` setting (default: `line`) controls how inbound data is delivered on output port 2:

- **binary** — each received frame emitted immediately; `payload` is a Buffer.
- **line** — fragments are buffered and split on CR or CR+LF; each complete line is emitted with `payload` as a string. If `waitFor` (a regex) is set, lines accumulate until one matches; the output message then contains `payload` (array of preceding lines) and `match` (the matching line). If the timeout fires before a match, a `timeout` event is emitted on port 1 along with whatever has buffered so far.

`mode` and `waitFor` can be set on the node and overridden per-message via `msg.mode` and `msg.waitFor`.

**Payload output type.** Several nodes have a `payloadOutput` editor option (`"string"` or `"buffer"`, default `"string"`) that controls whether the AX.25 data payload is delivered as a UTF-8 string or a raw Buffer:

- `ui-in` — decoded AX.25 UI frame payload
- `decode` — decoded AX.25 frame payload

`raw-in` always emits payload as a Buffer (raw AX.25 wire bytes, leading AGWPE port byte stripped). `connect` and `send` payload type is governed by `mode` as described above.

**Outbound segmentation at 255 bytes.** Payloads larger than 255 bytes are segmented into multiple AGWPE frames before transmission.

**Optional auth.** `username` and `password` fields in the config node editor pass AGWPE-level credentials. Many LAN deployments omit them.

## Message contract summary

All output messages include `timestamp` (ISO-8601). Errors always include `errorCode` and `errorText`. Connected session events include `instanceId`, `sessionId`, and `event` (`connected`, `disconnecting`, `disconnected`, `failed`, `timeout`). Inbound data messages include `instanceId`, `sessionId`, `event: "data"`, `payload`, `source`, `destination`, and `via`. Outbound segmented sends attach `messageId`, `chunkIndex`, and `chunkCount` to each chunk.

Full contract details are in [README.md](README.md).

## Node list

| Node | Direction | Role |
|------|-----------|------|
| `agwpe-client` | config | Owns the AGWPE TCP connection; configured in the editor; connects on deploy |
| `agwpe-control` | in + 1 out | Runtime control: connect, disconnect, set-config, get-config, get-status |
| `connect` | in + 2 out | Establish an AX.25 session; output 1: lifecycle events; output 2: received data |
| `send` | in + 2 out | Send data or disconnect on an established session; output 1: events; output 2: received data |
| `ui-out` | data in | Encode and send AX.25 UI frames via AGWPE K raw transport |
| `ui-in` | data out | Decode incoming AGWPE K raw traffic to AX.25 UI frame fields |
| `monitor-in` | data out | Passive monitor stream (monitor mode must be enabled) |
| `raw-out` | data in | Send raw AGWPE frames (raw mode must be enabled) |
| `raw-in` | data out | Receive raw AGWPE frames (raw mode must be enabled) |
| `decode` | transform | AX.25 frame bytes → JSON (source, destination, via, control, PID, payload) |
| `encode` | transform | Structured JSON → raw AX.25 frame bytes |

## Test strategy

Three test layers under `test/`:

- **contract/** — message shape and field validation, independent of Node-RED wiring
- **integration/** — full node loading + wiring with `node-red-node-test-helper`; covers open/close flows, session lifecycle, routing, segmentation, mode toggling
- **unit/** — isolated lib module behavior (codec, segmentation, router, registry)

Transport boundaries are mocked; no live AGWPE server is required for any test.

## Project layout

```text
nodes/          runtime JS + editor HTML for all eleven node types
lib/            shared internals (transport, router, registry, codec, segmentation)
test/           contract / integration / unit test suites
examples/       importable Node-RED example flows
docs/           development guidance (AI working agreement, Node-RED patterns)
```

## Known limitations and deferred work

- No TLS support for the AGWPE TCP transport
