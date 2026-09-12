# Filtering stored events

`SeptClient.getStoredEvents(filters)` queries events persisted in the client's
local SQLite store. Filtering is an SDK convenience and is not part of the SEPT
wire protocol.

The filtering surface is still pre-1.0 and may evolve independently of the
protocol.

## Basic filters

Pass an object whose keys are event fields. Filters are combined with `AND` and
results are ordered by `sequence` descending.

```js
const events = await sept.getStoredEvents({
  type: "message.send",
  isOutgoing: true,
  sequence__gt: 10,
})
```

The documented event fields are:

| Field | Meaning |
| --- | --- |
| `id` | Event ID |
| `type` | Application or SEPT system event type |
| `senderDeviceId` | Sender device ID |
| `timestamp` | Sender-provided event timestamp |
| `deliveredAt` | Local delivery timestamp, when available |
| `sequence` | Relay-assigned sequence number |
| `isSystem` | Whether this is a SEPT system event |
| `isOutgoing` | Whether the local device sent the event |
| `isIncoming` | Whether the local device received the event |
| `hasAttachment` | Whether the event has an attachment |
| `processedAt` | Handler completion timestamp, or `null` while pending |
| `handlerResult` | Handler return value, or the stored error string |
| `handlerFailed` | Whether handler processing failed |
| `createdAt` | Local persistence timestamp |

Boolean values can be passed as JavaScript booleans:

```js
const incoming = await sept.getStoredEvents({
  isIncoming: true,
  isSystem: false,
})
```

For example, failed application handlers can be queried with:

```js
const failed = await sept.getStoredEvents({
  handlerFailed: true,
})
```

## Operators

Append `__<operator>` to a field name. With no suffix, `eq` is used.

| Suffix | Comparison | Example |
| --- | --- | --- |
| none or `__eq` | Equal | `{ type: "message.send" }` |
| `__ne` | Not equal | `{ type__ne: "message.send" }` |
| `__gt` | Greater than | `{ sequence__gt: 10 }` |
| `__gte` | Greater than or equal | `{ timestamp__gte: from }` |
| `__lt` | Less than | `{ sequence__lt: 100 }` |
| `__lte` | Less than or equal | `{ timestamp__lte: to }` |
| `__in` | In a non-empty array | `{ type__in: ["message.send", "file.offer"] }` |
| `__notin` | Not in a non-empty array | `{ type__notin: ["sept.policy.update"] }` |
| `__is` | SQL `IS`, normally used with `null` | `{ deliveredAt__is: null }` |
| `__isnot` | SQL `IS NOT`, normally used with `null` | `{ sequence__isnot: null }` |

Unknown operator suffixes and unknown fields within supported event or relation filters throw an error.

## Relation filters

Nested `recipient` and `device` objects filter the recipient relations joined
to stored events. They can be combined with event-field filters and with each
other.

### Recipient relation

Use `recipient.deviceId` to select outgoing events addressed to a device:

```js
const sentToDevice = await sept.getStoredEvents({
  type: "message.send",
  recipient: {
    deviceId: recipientDeviceId,
  },
})
```

Operators use the same suffix syntax:

```js
const sentToKnownRecipients = await sept.getStoredEvents({
  recipient: {
    deviceId__in: [deviceA, deviceB],
  },
})
```

### Device relation

The `device` relation is the device record associated with the recipient. It is
not the sender; use the top-level `senderDeviceId` field to filter by sender.

Documented recipient-device fields are `id`, `networkId`, `role`, `revokedAt`
and `createdAt`.

```js
const sentToUsers = await sept.getStoredEvents({
  type: "message.send",
  isOutgoing: true,
  device: {
    role: "user",
    revokedAt__is: null,
  },
})
```

A combined relation query can target both the join record and the associated
device:

```js
const events = await sept.getStoredEvents({
  sequence__gt: 10,
  recipient: {
    deviceId__ne: excludedDeviceId,
  },
  device: {
    role__in: ["user", "admin"],
  },
})
```

## Result shape and current limitations

The method returns locally stored event objects. When a result comes from the
recipient join it also includes `recipientDeviceId`.

The current query uses one joined row per recipient. Consequently, an outgoing
event with multiple recipients can appear more than once, with a different
`recipientDeviceId` in each result. Applications that need unique events should
deduplicate by event `id`.

Incoming events do not normally have local recipient rows. Applying a
`recipient` or `device` relation filter therefore generally selects outgoing
events only.

Payload, handler-result contents and cryptographic-storage fields are
intentionally not part of the documented filtering surface. Query application
payloads and handler results after retrieving and deserializing the stored
events.
