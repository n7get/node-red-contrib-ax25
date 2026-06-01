# Node Messages Reference

All messages include a `timestamp` (ISO 8601 string).  
Messages with `status: "ok"` are built by `okEnvelope(fields)`.  
Messages with `status: "error"` are built by `errorEnvelope(errorCode, errorText, fields)` and always include `errorCode` and `errorText`.

---

## agwpe-client

Configuration node. No inputs or outputs.

---

## connect

Initiates an AX.25 connected session. Two outputs: **output 1** (events), **output 2** (data).

### Input

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | no¹ | Calling callsign. Falls back to node config, then first registered callsign. |
| `destination` | string | no¹ | Called callsign. Falls back to node config. |
| `via` | string \| string[] | no | Digipeater path. Falls back to node config. |
| `sessionId` | string | no | Override the auto-generated session ID. |
| `mode` | `"line"` \| `"binary"` | no | Data framing mode. Falls back to node config (default: `"line"`). |
| `timeout` | number | no | Inactivity timeout in milliseconds. Falls back to node config. |
| `waitFor` | string | no | Regex pattern. Buffers inbound lines until a match; then emits all at once. Falls back to node config. |

¹ Required unless provided by node config or registered callsign.

### Output 1 — events

#### `status: "ok"` messages

| `event` | Additional fields | When |
|---|---|---|
| `connecting` | `instanceId`, `sessionId`, `source`, `destination`, `via` | C frame sent to TNC |
| `connected` | `instanceId`, `sessionId`, `source`, `destination`, `called` | TNC confirmed connection |
| `disconnecting` | `instanceId`, `sessionId`, `source`, `destination` | Disconnect initiated |
| `disconnected` | `instanceId`, `sessionId`, `source`, `destination` | TNC confirmed disconnect |

#### `status: "error"` messages

| `errorCode` | `errorText` | Additional fields | When |
|---|---|---|---|
| `CLIENT_NOT_CONNECTED` | `AGWPE Client is not open` | `instanceId` | Input received while transport is not connected |
| `CONNECT_INVALID` | `connect requires source and destination` | `instanceId` | Source or destination could not be resolved |
| `SESSION_ID_CONFLICT` | `Session already exists` | `instanceId` | Supplied `sessionId` is already in use |
| `SESSION_ID_REUSED` | `Server session ID collision detected` | `instanceId`, `sessionId`, `serverSessionId` | TNC reused a session ID for a different session |
| `CONNECT_FAILED` | `Connection attempt failed` | `instanceId`, `sessionId`, `source`, `destination` | TNC sent a `d` frame before ever confirming with a `C` frame |
| `TIMEOUT` | `Inactivity timeout` | `instanceId`, `sessionId`, `event: "timeout"` | Inactivity timer expired (binary mode) |
| `TIMEOUT` | `Inactivity timeout` | `instanceId`, `sessionId`, `event: "timeout"`, `waitFor`, `lineBuffer`, `waitForBuffer` | waitFor timer expired before the regex matched (line mode) |

> **Note:** Timeout messages may be emitted by a **send** node instead of the connect node if a send node currently holds the output claim for the session.

### Output 2 — data

All data messages have `status: "ok"`, `event: "data"`, `instanceId`, `sessionId`, `source`, `destination`, `via`.

| Mode | `payload` type | `match` field | When |
|---|---|---|---|
| `binary` | `Buffer` | — | Inbound D frame received |
| `line` (no waitFor) | `string` | — | One complete line received (CR or CR+LF delimited) |
| `line` (waitFor active) | `string[]` — lines before the match | `string` — the matching line or fragment | First line matching the waitFor regex arrives |
| `line` (disconnect flush) | `string[]` — buffered lines | — | Session disconnects while lines are buffered |

---

## send

Sends data over an existing AX.25 connected session. Two outputs: **output 1** (events), **output 2** (data).

### Input

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | ID of the target session |
| `payload` | string \| Buffer \| Array<string\|Buffer> | yes | Data to send. Arrays are sent as separate D frames. |
| `waitFor` | string | no | Regex pattern. Claims data output and buffers until a match. Falls back to node config. |
| `timeout` | number | no | Override inactivity timeout in milliseconds. Falls back to node config. |

### Output 1 — events

#### `status: "ok"` messages

| `event` | Additional fields | When |
|---|---|---|
| `sent` | `instanceId`, `sessionId`, `messageId`, `chunkCount` | All payload items delivered to TNC |

#### `status: "error"` messages

| `errorCode` | `errorText` | Additional fields | When |
|---|---|---|---|
| `SESSION_NOT_FOUND` | `Session not found` | `sessionId` | `msg.sessionId` not in the session registry |
| `SESSION_NOT_CONNECTED` | `Session is not connected` | `sessionId` | Session exists but state is not `"connected"` |
| `PAYLOAD_INVALID` | `payload items must be string or Buffer` | `sessionId` | A payload item is not a string or Buffer |
| `TIMEOUT` | `Inactivity timeout` | (same as connect timeout) | Timer fired while this node holds the output claim |

### Output 2 — data

Same shape as connect output 2. The send node takes the data output claim when it processes an input; data arrives on this output until the session disconnects or a different send node claims it.

---

## disconnect

Initiates graceful disconnect of an existing session. One output (events).

### Input

| Field | Type | Required | Description |
|---|---|---|---|
| `sessionId` | string | yes | ID of the session to disconnect |

### Output — events

#### `status: "ok"` messages

| `event` | Additional fields | When |
|---|---|---|
| `disconnecting` | `instanceId`, `sessionId` | Disconnect frame sent to TNC |

#### `status: "error"` messages

| `errorCode` | `errorText` | Additional fields | When |
|---|---|---|---|
| `SESSION_NOT_FOUND` | `Session not found` | `sessionId` | `msg.sessionId` not in the session registry |

> The corresponding `disconnected` event is emitted by the **connect** node when the TNC confirms with a `d` frame.

---

## raw-in

Receives raw AX.25 frames (K frames) from the TNC. No input. One output.

Raw mode must be enabled on the agwpe-client node.

### Output

| `status` | `event` | Fields | Description |
|---|---|---|---|
| `ok` | `raw` | `instanceId`, `payload` (Buffer), `agwpePort`, `source`, `destination`, `via` | Raw AX.25 wire frame received from TNC |

---

## raw-out

Transmits a raw AX.25 frame (K frame) via the TNC. One output.

Raw mode must be enabled on the agwpe-client node.

### Input

| Field | Type | Required | Description |
|---|---|---|---|
| `payload` | Buffer \| Uint8Array \| byte array \| hex string \| encode envelope | yes | AX.25 wire frame to transmit |
| `agwpePort` | number | no | AGWPE port (0–255). Falls back to `msg.flag`, then node config (default: `0`). |

### Output

#### `status: "ok"` messages

| `event` | Additional fields | When |
|---|---|---|
| `raw-sent` | `instanceId` | Frame handed to transport |

#### `status: "error"` messages

| `errorCode` | `errorText` | When |
|---|---|---|
| `CLIENT_NOT_FOUND` | `AGWPE Client instance not found` | agwpe-client config node is missing |
| `RAW_MODE_DISABLED` | `Raw mode is disabled` | Raw mode not enabled on agwpe-client |
| `RAW_FRAME_INVALID` | `Raw frame payload/agwpePort is invalid; payload must be Buffer, byte array, Uint8Array, hex string, or encode envelope` | Payload could not be parsed or `agwpePort` is out of range |

---

## monitor-in

Receives monitored AX.25 frames from the TNC (all traffic, not just connected sessions). No input. One output.

Monitor mode must be enabled on the agwpe-client node.

### Output

| `status` | `event` | Fields | Description |
|---|---|---|---|
| `ok` | `monitor` | `instanceId`, `payload` (Buffer), `source`, `destination`, `via` | Monitored frame received |

---

## encode

Encodes an AX.25 frame from field inputs into a wire-format Buffer. One output.

### Input

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | no¹ | Source callsign. Falls back to node config (default: `"N0CALL"`). |
| `destination` | string | no¹ | Destination callsign. Falls back to node config (default: `"CQ"`). |
| `via` | string \| string[] \| object[] | no | Digipeater path. Falls back to node config. |
| `frameType` | `"I"` \| `"S"` \| `"U"` | no | Determines control byte if `control` is not set. Falls back to node config (default: `"U"`). |
| `control` | number (0–255) | no | Explicit control byte. Overrides `frameType`. Falls back to node config (default: `3`). |
| `pid` | number (0–255) | no | Protocol identifier byte. Falls back to node config (default: `240` / `0xF0`). |
| `payload` | string \| Buffer | no | Frame payload. Falls back to node config. |
| `agwpePort` | number | no | Passed through to output for use by raw-out. |

¹ Required unless provided by node config.

### Output

#### `status: "ok"` messages

| `event` | Additional fields | When |
|---|---|---|
| `encoded` | `payload` (Buffer), `agwpePort` | Frame successfully encoded |

#### `status: "error"` messages

| `errorCode` | `errorText` | When |
|---|---|---|
| `ENCODE_INPUT_INVALID` | `source, destination, and control/frameType are required` | Required fields missing |
| `ENCODE_FAILED` | codec error message | Codec rejected the input |

---

## decode

Decodes a wire-format AX.25 frame Buffer into structured fields. One output.

### Input

| Field | Type | Required | Description |
|---|---|---|---|
| `payload` | Buffer | yes | AX.25 wire-format frame |
| `agwpePort` | number | no | Passed through to output. Falls back to `msg.agwpePrefix`, then `0`. |

### Output

#### `status: "ok"` messages

Fields from the decoded frame, plus:

| Field | Type | Description |
|---|---|---|
| `status` | `"ok"` | |
| `agwpePort` | number | Normalized AGWPE port |
| `source` | string | Source callsign |
| `destination` | string | Destination callsign |
| `via` | object[] | Digipeater path |
| `control` | number | Control byte |
| `pid` | number | PID byte |
| `payload` | string \| Buffer | Frame payload (string if node config `payloadOutput` is `"string"`) |

#### `status: "error"` messages

| `errorCode` | `errorText` | When |
|---|---|---|
| `DECODE_INPUT_INVALID` | `payload must be Buffer` | Input payload is not a Buffer |
| `DECODE_FAILED` | codec error message | Codec rejected the frame |

---

## ui-in

Receives UI (unproto) AX.25 frames from raw traffic. No input. One output.

Raw mode must be enabled on the agwpe-client node.

### Output

| `status` | `event` | Fields | Description |
|---|---|---|---|
| `ok` | `ui` | `instanceId`, `source`, `destination`, `via`, `payload` (string or Buffer) | UI frame received (`payload` is string if node config `payloadOutput` is `"string"`) |

---

## ui-out

Transmits a UI (unproto) AX.25 frame via the TNC. One output.

Raw mode must be enabled on the agwpe-client node.

### Input

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | no¹ | Source callsign. Falls back to node config. |
| `destination` | string | no¹ | Destination callsign. Falls back to node config. |
| `via` | string \| string[] \| object[] | no | Digipeater path. Falls back to node config. |
| `payload` | string \| Buffer | no¹ | Frame payload. Falls back to node config. |
| `agwpePort` | number | no | AGWPE port. Falls back to `0`. |

¹ Required unless provided by node config.

### Output

#### `status: "ok"` messages

| `event` | Additional fields | When |
|---|---|---|
| `ui-sent` | `instanceId` | UI frame handed to transport |

#### `status: "error"` messages

| `errorCode` | `errorText` | When |
|---|---|---|
| `CLIENT_NOT_FOUND` | `AGWPE Client instance not found` | agwpe-client config node is missing |
| `RAW_MODE_DISABLED` | `Raw mode is disabled` | Raw mode not enabled on agwpe-client |
| `UI_SEND_INVALID` | `ui-out requires source, destination, and payload (set in editor or input message)` | Required fields missing or empty |
| `UI_SEND_INVALID` | codec error message | Frame encoding failed |
