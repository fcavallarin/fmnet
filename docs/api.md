# `@sept/client` API

This page documents the **public** `SeptClient` surface. Methods prefixed with `_` in the implementation are internal and intentionally omitted.

The runtime implementation is plain JavaScript. This reference describes behavior rather than promising a frozen pre-1.0 TypeScript contract.

## Construction

### `SeptClient.create(options)`

Creates and initializes a SEPT client, database adapter and local stores.

```js
const sept = await SeptClient.create({
  restEndpoint,
  dataStore: {
    type: "better-sqlite" | "expo-sqlite",
    open,
    close,
    clearDb,
  },
  secretKeyProvider,
})
```

`restEndpoint` defaults to `http://localhost:8787`.

## Lifecycle and identity

### `bootstrap()`

Creates a new SEPT network and the first admin/root device.

Returns the network ID.

### `initDevice()`

Initializes signing/encryption keys for a device that has not joined a network yet.

Returns:

```js
{
  deviceId,
  signPublicKey,
  cryptPublicKey,
}
```

### `resetDevice()`

Resets the local SEPT database through the configured datastore adapter.

### `getDeviceId()`

Returns the current local device ID or `null`.

### `getNetworkId()`

Returns the current network ID or `null`.

### `getDevices()`

Returns locally known non-revoked devices.

### `getAdmins()`

Returns a simplified list of locally known admin devices:

```js
{
  deviceId,
  signPublicKey,
  cryptPublicKey,
}
```

## Pairing

### `addDevice(deviceData, metadata, onPaired, onPairingTimeout, pairingTimeout = 60)`

Admin-side pairing initiation.

Returns the short-lived PIN immediately and starts the completion polling flow asynchronously.

`metadata` may contain separate views for the joining device and initiating admin:

```js
{
  deviceMetadata: {},
  adminMetadata: {},
}
```

Callbacks:

```js
onPaired(deviceId, metadata)
onPairingTimeout(deviceId)
```

### `pairDevice(pin)`

Joining-device side pairing redemption. Decrypts and installs the network/admin bootstrap state.

Returns pairing metadata intended for the joining device.

## Application events

### `register(eventType, handler, serial = true)`

Registers an application event handler.

```js
sept.register("message.send", async (
  payload,
  senderDeviceId,
  timestamp,
  eventId,
  sequence,
) => {
  // ...
})
```

SEPT-reserved system event types cannot be registered through this API.

### `registerConcurrent(eventType, handler)`

Equivalent to `register(eventType, handler, false)`.

Use only when the handler is safe to execute without blocking later event processing.

### `sendEvent(type, payload, dstDeviceIds)`

Checks policy, encrypts/signs/persists the event and submits it to the relay.

```js
await sept.sendEvent(
  "message.send",
  { text: "hello" },
  [deviceA, deviceB],
)
```

Throws if no valid recipients remain or local authorization denies an event for a recipient.

### `getStoredEvents(filters = {})`

Queries locally stored events using the current store filtering DSL.

This is an SDK/query convenience. The filter surface is not a SEPT wire-protocol concept and may evolve independently.

## Authorization

### `getPolicy(srcDeviceId, dstDeviceId)`

Returns the local directed policy, if present.

### `checkPolicy(srcDeviceId, dstDeviceId, eventType)`

Returns whether the source device is locally authorized to send `eventType` to the destination.

Admins currently return `true` without requiring an explicit edge capability.

### `grant(srcDeviceId, dstDeviceId, eventTypes, metadata)`

Adds event types to a directed policy and distributes a policy update.

### `revoke(srcDeviceId, dstDeviceId, eventTypes, metadata)`

Removes event types from a directed policy and distributes a policy update.

### `isAdmin(deviceId)`

Returns whether a locally known device currently has role `admin`.

### `isCurrentDeviceAdmin()`

Returns whether the local device is an admin.

### `getDeviceGraph()`

Returns the locally stored directed device/policy graph.

## Admin/device management

### `grantAdmin(deviceId, metadata = {})`

Promotes a device to admin, distributes `sept.admin.grant`, updates relay transport/admin state, and sends current device/policy state to the promoted device.

### `revokeAdmin(deviceId)`

Demotes an admin to a normal user, distributes `sept.admin.revoke`, and updates relay state.

### `invalidateDevice(deviceId)`

Invalidates a device. The client distributes `sept.device.invalidate` to relevant peers/admins, updates relay state and marks the device revoked locally.

## Connectivity and synchronization

### `connect()`

Obtains a relay ticket, opens the WebSocket connection and synchronizes pending events.

The method is bound as a public arrow function and can be passed as a callback without losing `this`.

### `disconnect()`

Closes the current WebSocket connection.

### `getWebsocketStatus()`

Returns the current internal connection status string.

Current implementation states include values such as:

```text
disconnected
tickedRequested
connecting
connected
reconnecting
reconnectingOnError
closing
closed
error
```

These strings are implementation-level status values and should not yet be treated as a frozen enum.

### `sync()`

Pulls pending events through REST and feeds them into the normal receive pipeline.

### `startPolling(time)`

Starts periodic `sync()` every `time` seconds.

### `stopPolling()`

Stops the polling interval.

## Client/UI events

### `on(eventName, handler)`

Subscribes to SEPT client lifecycle/system notifications.

Current connection events:

```text
connection.open
connection.close
connection.error
connection.message
```

System event names can also be subscribed to. The implementation accepts the short form for known `sept.*` events when it can resolve it unambiguously.

## Application KV storage

### `appStorage(namespace)`

Returns a namespaced persistent store:

```js
const store = sept.appStorage("fmnet")

await store.set("value", 1)
await store.set("value", current => (current ?? 0) + 1)

await store.get("value")
await store.keys()
await store.all()
await store.delete("value")
```

Operations are serialized through an async queue so functional `set()` performs a local read-modify-write in order relative to other operations in the same returned namespace facade.

## Server extension escape hatch

### `callRest(path, options)`

Calls a custom relay endpoint using the SEPT signed-request client.

This is useful for application-specific relay plugins such as FMNet's push-token registration.

```js
await sept.callRest("register-push-token", {
  method: "POST",
  body: { token },
})
```

Prefer protocol-level methods when they exist; `callRest()` intentionally exposes custom server integration.

## Reserved system events

Current internal protocol event types:

```text
sept.policy.update
sept.admin.grant
sept.admin.revoke
sept.device.add
sept.device.invalidate
```

They are not ordinary application event registrations.
