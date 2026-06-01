# Architecture: node-red-contrib-ax25

## Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Node-RED flow                                              │
│  (inject, function, debug, etc.)                            │
└──────────────────────┬──────────────────────────────────────┘
                       │ msg
┌──────────────────────▼──────────────────────────────────────┐
│  Node layer  (nodes/)                                       │
│  agwpe-client · connect · send · disconnect                 │
│  ui-out · ui-in · monitor-in · raw-out · raw-in             │
│  decode · encode                                            │
└──────┬───────────────────────────┬──────────────────────────┘
       │ transport calls           │ routed frames
┌──────▼──────────┐   ┌────────────▼──────────────────────────┐
│ AgwpeClient     │   │ FrameRouter                           │
│ Transport       │   │ (lib/frame-router.js)                 │
│ (lib/agwpe-     │   │ routes parsed frames to per-instance  │
│  client-        │   │ handler callbacks by frame kind       │
│  transport.js)  │   └──────────────┬────────────────────────┘
│                 │                  │ handler callbacks
│  Node.js        │   ┌──────────────▼────────────────────────┐
│  net.Socket     │   │ SessionRegistry                       │
│  EventEmitter   │   │ (lib/session-registry.js)             │
└──────┬──────────┘   │ tracks Ax25Session lifecycle per      │
       │ raw bytes    │ instance; maps serverSessionId ↔      │
       │              │ sessionId                             │
       │              └───────────────────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────────┐
│  AGWPE server (external)                                    │
│  TCP port 8000 (default)                                    │
└─────────────────────────────────────────────────────────────┘
```

## Shared lib modules

| Module | Role |
|--------|------|
| `agwpe-client-transport.js` | Wraps `net.Socket`; emits `connected`, `error`, `close`, and raw `frame` events; injectable `socketFactory` for testing |
| `agwpe-frame-builder.js` | Builds AGWPE binary frame headers for each frame kind (P, X, C, D, U, K, m, M) |
| `agwpe-frame-pretty.js` | Debug-friendly AGWPE frame formatting for transport logging |
| `ax25-codec.js` | AX.25 frame encode/decode (callsign bit-shifting, via path, control, PID, payload) |
| `frame-router.js` | Parses raw AGWPE bytes into typed frame objects; dispatches to per-instance handler maps |
| `frame-segmentation.js` | Splits outbound payloads into ≤255-byte chunks; attaches `messageId`/`chunkIndex`/`chunkCount` metadata |
| `message-utils.js` | `nowTimestamp()`, `makeMessageId()` — shared across nodes and lib |
| `runtime-store.js` | In-memory store for per-instance context objects; also hosts a module-level `globalBus` (EventEmitter forwarding `conn-data`, `conn-lifecycle`, `conn-timeout-set` from all instances) and a `sessionIndex` map (`sessionId → instanceId`) that lets `send` resolve the correct instance at runtime without a static client reference |
| `session-registry.js` | CRUD for `Ax25Session` records; indexes by `instanceId` + `sessionId` and by `serverSessionId` |

## Node internals pattern

Most nodes follow this structural pattern:

```
node constructor
  ├── validate config
  ├── resolve agwpe-client instance (RED.nodes.getNode) ← all nodes except send
  ├── register handler callbacks on agwpe-client's FrameRouter
      node.on("input", ...)   ← triggers on any message
        ├── connect           (connect node — uses msg.destination)
        ├── send              (send, ui-out, raw-out — uses msg.payload)
        └── disconnect        (disconnect node — uses msg.sessionId)

node.on("close", ...)
  └── deregister from FrameRouter; destroy transport if agwpe-client
```

## AGWPE frame kind to Node-RED node routing

| AGWPE frame kind | Emitted to node |
|------------------|-----------------|
| D (connected data) | `connect` or `send` — matched by session callsign pair |
| C (connect/disconnect lifecycle) | `connect` — lifecycle event |
| U / K (UI/raw) | `ui-in` or `raw-in` — gated by mode flag |
| M / m (monitor) | `monitor-in` — gated by `monitorEnabled` flag |
| X (callsign registration ACK) | consumed by `agwpe-client` internally |
| P (login/auth) | consumed by `agwpe-client` internally |

## Session index and global bus

`runtime-store` maintains a module-level `sessionIndex` map (`sessionId → instanceId`). The `connect` node writes to this index when a session is created and removes the entry on disconnect. The `send` node uses `instanceIdForSession(sessionId)` at message-handling time to look up the correct instance — no static client reference is needed.

`runtime-store` also hosts a `globalBus` EventEmitter. Each instance `bus` forwards `conn-data`, `conn-lifecycle`, and `conn-timeout-set` events to `globalBus` so `send` nodes can subscribe once for all instances.

## connect node transport status

The `connect` node mirrors the transport state of its `agwpe-client` as a Node-RED status badge:

| agwpe-client state | connect node status |
|--------------------|---------------------|
| connecting | yellow dot — `connecting` |
| connected | green dot — `ready` |
| reconnecting | yellow ring — `reconnecting...` |
| disconnected | grey ring — `disconnected` |
| failed | red dot — `failed` |

On startup, the connect node reads `context.state` to set the initial status immediately. Ongoing changes are driven by `transport-connecting`, `transport-connected`, `transport-reconnecting`, `transport-closed`, and `failed` events on the instance bus.

## Session lifecycle state machine

```
connecting → connected → disconnecting → disconnected
     ├──────────────────────────────────────→ failed
     └──────────────────────────────────────→ connect-failed (d-frame before C-frame confirmed)
```

Transitions are driven by AGWPE C-frame events and transport errors. On any transport failure all sessions in the owning instance transition to `failed` immediately.

## Message shape contracts

### connect node input

```json
{ "source": "N0CALL", "destination": "REMOTE-1" }
```

### send node input

```json
{ "sessionId": "sess-abc", "payload": "hello" }
```

### disconnect node input

```json
{ "sessionId": "sess-abc" }
```

### Standard success output envelope

```json
{ "timestamp": "…", "status": "ok", "instanceId": "…",
  "sessionId": "opt", "event": "connected" }
```

### Standard error output envelope

```json
{ "timestamp": "…", "status": "error",
  "errorCode": "AUTH_FAILED", "errorText": "…",
  "instanceId": "…", "sessionId": "opt" }
```

### Outbound chunk envelope (attached per segment by send, ui-out)

```json
{ "messageId": "msg-abc", "chunkIndex": 0, "chunkCount": 3, "payload": "…" }
```

Payloads ≤255 bytes produce a single chunk (`chunkIndex: 0`, `chunkCount: 1`).

### Inbound data envelope (connect, send, ui-in)

```json
{ "timestamp": "…", "instanceId": "…", "sessionId": "…",
  "event": "data", "payload": "…",
  "source": "REMOTE-1", "destination": "N0CALL", "via": [] }
```

Each received AGWPE frame is emitted immediately. No grouping metadata is added — there is no way to know whether the remote intended several frames as one logical payload.

## Testability design

- `AgwpeClientTransport` accepts an injectable `socketFactory` — tests pass a fake factory that returns a mock socket
- `FrameRouter` and `SessionRegistry` are stateless relative to the transport and can be instantiated and exercised independently
- `node-red-node-test-helper` is used for all integration-level tests; no live AGWPE server required

## Extension points for future work

- **Inbound reassembly**: an optional reassembly buffer keyed on a session + sequence, with a configurable flush timeout
- **TLS transport**: replacing `net.createConnection` with `tls.connect` via the existing `socketFactory` injection point
