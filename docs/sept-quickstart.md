# SEPT JavaScript quick start

This guide shows the shape of direct `@sept/client` usage. The FMNet CLI remains the easiest runnable end-to-end example because it already provides datastore wiring, user interaction and application event definitions.

## Install from the monorepo

From the repository root, install only the workspaces required by the SEPT JavaScript client:

```bash
npm run install:client
```

The client-only installation includes:

```text
@sept/client
@sept/core
@sept/crypto
```

Use plain `npm install` instead when developing the complete monorepo, including the Cloudflare server/Worker and FMNet applications.

`SeptClient` requires a SQLite-compatible datastore adapter configuration and a SEPT relay endpoint.

For this Node.js example, also install the SQLite driver:

```bash
npm install better-sqlite3
```

## Create a client

A client is constructed with `SeptClient.create()`:

```js
import { SeptClient } from "@sept/client"
import Database from "better-sqlite3"

const sept = await SeptClient.create({
  restEndpoint: "http://localhost:8787",
  dataStore: {
    type: "better-sqlite",
    open: () => new Database("app.db"),
    close: db => db.close(),
  },

  // Application-specific provider used to encrypt secrets
  // Must return the same securely stored 32-byte key across restarts.
  secretKeyProvider: async () => loadSecretKey(),
})
```

`dataStore.type` currently supports the runtimes implemented by the client:

- `better-sqlite`
- `expo-sqlite`

The `open` and `close` functions are supplied by the host application. See FMNet's Node and mobile integrations for concrete wiring.

## Create a network

The first device bootstraps a SEPT network and becomes an admin:

```js
const networkId = await sept.bootstrap()
const deviceId = await sept.getDeviceId()

console.log({ networkId, deviceId })
```

`bootstrap()` creates local signing/encryption keys, creates the local network and root device records, and registers the network/root signing public key with the relay.

## Initialize a device that will join

A device that has not joined a network yet first creates its key material:

```js
const deviceData = await sept.initDevice()
```

The returned value can be transported to an admin through your UI, QR code or another out-of-band channel:

```js
{
  deviceId,
  signPublicKey,
  cryptPublicKey,
}
```

## Pair a new device

On an existing admin device:

```js
const pin = await adminSept.addDevice(
  deviceData,
  {
    deviceMetadata: { name: "Laptop" },
    adminMetadata: { name: "Laptop" },
  },
  async (deviceId, metadata) => {
    console.log("paired", deviceId, metadata)
  },
  async deviceId => {
    console.log("pairing timed out", deviceId)
  },
  60,
)

console.log("Pairing PIN:", pin)
```

On the joining device:

```js
const metadata = await joiningSept.pairDevice(pin)
```

The pairing PIN is short-lived. The joining device has no previously trusted admin key at this point, so pairing is the trust-bootstrap phase; read [Security](security.md#pairing-trust-bootstrap) before building a high-risk enrollment flow.

## Register an application event

SEPT applications define their own event types:

```js
sept.register("message.send", async ({
  payload,
  senderDeviceId,
  timestamp,
  eventId,
  sequence,
}) => {
  console.log(senderDeviceId, payload.text)
})
```

Handlers are serial by default. If an application event may run independently of later events:

```js
sept.registerConcurrent("telemetry.sample", async ({ payload }) => {
  await processSample(payload)
})
```

System event types such as `sept.policy.update` are owned by SEPT and cannot be registered as application handlers.

## Grant permission

A paired non-admin device is not automatically allowed to send every event type to every destination.

An admin grants a directed capability:

```js
await adminSept.grant(
  senderDeviceId,
  recipientDeviceId,
  ["message.send"],
  { reason: "chat permission" }, // Optional metadata
)
```

Check a policy locally:

```js
const allowed = await sept.checkPolicy(
  senderDeviceId,
  recipientDeviceId,
  "message.send",
)
```

See [Authorization](authorization.md) for the model and admin behavior.

## Send an event

```js
await sept.send(
  "message.send",
  { text: "hello" },
  [recipientDeviceId],
)
```

`send()`:

1. resolves recipient public keys from local state;
2. checks the sender-to-recipient policy;
3. encrypts the event payload with a fresh symmetric payload key;
4. wraps that key independently for each recipient;
5. signs the event material;
6. stores the outgoing event locally;
7. posts the encrypted event to the relay.

## Receive events

SEPT distinguishes between application events and client events:

- **Application events** are defined by your application and handled through
  `register()` or `registerConcurrent()`.
- **Client events** are defined and emitted locally by the SEPT client. They
  report SEPT system changes or connection activity and are handled through
  `on()`.

### SEPT system events

System events are emitted after the client successfully processes a
SEPT-owned protocol event and updates its local state:

```js
sept.on("policy.update", ({ policies, metadata }) => {
  console.log("policies updated", policies)
})

sept.on("admin.grant", ({ deviceId, metadata }) => {
  console.log("admin granted", deviceId)
})

sept.on("admin.revoke", ({ deviceId, metadata }) => {
  console.log("admin revoked", deviceId)
})

sept.on("device.add", device => {
  console.log("device added", device)
})

sept.on("device.invalidate", ({ deviceId }) => {
  console.log("device invalidated", deviceId)
})
```

The `sept.` prefix is optional for known system event names. For example,
`admin.grant` and `sept.admin.grant` subscribe to the same client event.

These notifications are different from application events: their names and
payloads are owned by SEPT, and they cannot be registered with `register()`.

### Connection events

Connection events describe the local WebSocket lifecycle and activity. They are
transport notifications, not application or protocol events:

```js
sept.on("connection.open", () => console.log("connected"))
sept.on("connection.close", () => console.log("disconnected"))
sept.on("connection.error", () => console.log("connection error"))
```

The client also emits `connection.message` when the WebSocket receives a raw
message, before it enters the normal receive pipeline. Most applications do not
need to subscribe to it.

### WebSocket connection

```js
await sept.connect()
```

The client opens a WebSocket, synchronizes pending events, and processes pushed events through the same receive pipeline.

Disconnect explicitly when required:

```js
await sept.disconnect()
```

### Polling

For runtimes where a persistent WebSocket is undesirable:

```js
sept.startPolling(10) // seconds
```

Stop it with:

```js
sept.stopPolling()
```

A manual synchronization is also available:

```js
await sept.sync()
```

## Query local state

```js
const myDeviceId = await sept.getDeviceId()
const networkId = await sept.getNetworkId()
const devices = await sept.getDevices()
const admins = await sept.getAdmins()
const graph = await sept.getDeviceGraph()
const events = await sept.getStoredEvents()
```

`getStoredEvents(filters)` exposes the current local event-store filtering API. It is an SDK convenience rather than a SEPT wire-protocol feature.

## Application storage

Applications using SEPT can reuse its persistent runtime store for small namespaced state:

```js
const prefs = sept.appStorage("my-app")

await prefs.set("theme", "dark")
console.log(await prefs.get("theme"))

await prefs.set("counter", current => (current ?? 0) + 1)
```

Available operations are `get`, `set`, `delete`, `keys` and `all`.

## Admin/device lifecycle

```js
await sept.grantAdmin(deviceId)
await sept.revokeAdmin(deviceId)
await sept.invalidateDevice(deviceId)
```

These operations update local state and distribute signed SEPT system events as appropriate. Device invalidation also updates relay-side transport state.

## Next steps

- [Architecture](architecture.md)
- [Protocol](protocol.md)
- [Authorization](authorization.md)
- [Security](security.md)
- [Client API](api.md)
