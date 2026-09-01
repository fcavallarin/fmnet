# Authorization model

SEPT uses a **local, directed, default-deny authorization model** for non-admin application events.

Pairing establishes device identity and distributes public keys. It does not mean that every paired device may perform every action against every other device.

## Directed policies

A policy is attached to a directed graph edge:

```text
source device  ─────►  destination device
                 policy
```

The current policy shape is intentionally small:

```js
{
  allowedEventTypes: [
    "message.send",
    "tcptunnel.connect"
  ]
}
```

Authorization therefore asks:

```text
May sourceDevice send eventType to destinationDevice?
```

The same two devices can have different policies in opposite directions.

```text
A ── message.send ──► B
A ◄─ telemetry.send ─ B
```

## Default deny

For a non-admin sender, `checkPolicy(src, dst, eventType)` returns false when:

- no graph edge/policy exists;
- the policy has no `allowedEventTypes` list;
- the event type is not in the list.

This means adding a device to a network is not equivalent to granting application capabilities.

## Admin behavior

A locally recognized admin currently passes `checkPolicy()` without requiring an explicit per-event edge policy.

Admin status is itself distributed through SEPT system events and stored in local device state. Current administrative API operations include:

```js
await sept.grantAdmin(deviceId)
await sept.revokeAdmin(deviceId)
```

Because admin status has broad consequences, applications should expose these operations carefully and should not treat relay-side `is_admin` state as a substitute for recipient-side protocol validation.

## Granting event types

An admin extends a directed policy with `grant()`:

```js
await sept.grant(
  srcDeviceId,
  dstDeviceId,
  ["message.send", "message.react"],
  metadata,
)
```

The client:

1. loads the current policy;
2. merges the requested event types without duplicates;
3. updates local graph state;
4. sends `sept.policy.update` to affected devices and other admins.

`metadata` is application-defined context carried with the system event; it is not part of the authorization decision itself.

## Revoking event types

```js
await sept.revoke(
  srcDeviceId,
  dstDeviceId,
  ["message.send"],
  metadata,
)
```

The event type is removed from the local directed policy and the updated policy is distributed through the same system-event mechanism.

## Policy distribution

`sept.policy.update` contains enough device/public-key and policy information for recipients to update their local trust graph.

Conceptually:

```js
{
  networkId,
  devices: [
    {
      id,
      signPublicKey,
      cryptPublicKey
    }
  ],
  policies: [
    {
      srcDeviceId,
      dstDeviceId,
      policy: {
        allowedEventTypes: ["message.send"]
      }
    }
  ],
  metadata
}
```

On receipt, the client first verifies/decrypts the enclosing SEPT event. System event routing is then allowed only when the sender is locally recognized as an admin.

## Authorization on send and receive

SEPT performs policy checks on both sides of the normal application flow.

### Sender side

Before encrypting/submitting an event for a recipient, `sendEvent()` checks the local policy. This provides fast failure and prevents the local application from intentionally sending an event it believes is unauthorized.

### Recipient side

After signature verification and decryption, the recipient independently checks:

```text
(senderDeviceId, localDeviceId, decryptedEventType)
```

Only then is the application handler invoked.

The recipient-side check is the important security boundary: authorization does not rely solely on the sender behaving correctly.

## Why the relay does not authorize application events

The relay authenticates registered devices for transport and protects relay operations such as pairing/admin state. But it does not need to be the authority that decides whether `message.send` or `tcptunnel.connect` is allowed.

Keeping application policy on devices has several properties:

- application event types can evolve without a central relay policy engine;
- self-hosted and public relays use the same application authorization model;
- a relay compromise does not automatically grant a sender new local application capabilities;
- devices can make authorization decisions from their persisted trust state.

This does **not** make the relay irrelevant to security. It still controls availability, routing, pending-event delivery and initial pairing bootstrap. See [Security](security.md).

## System events

Current reserved event types:

```text
sept.policy.update
sept.admin.grant
sept.admin.revoke
sept.device.add
sept.device.invalidate
```

Applications cannot register handlers for these as ordinary application events. They are routed through internal protocol handlers.

## Device invalidation

An admin can invalidate a device:

```js
await sept.invalidateDevice(deviceId)
```

The client distributes `sept.device.invalidate` to relevant admins/graph neighbors, updates relay transport state, and marks the device revoked locally.

Local stores ignore revoked devices in normal device lookups/graph queries.

## Application-level identities

SEPT policies are device-to-device. FMNet may expose a higher-level identity containing multiple devices and then expand one user-facing grant into multiple device-to-device grants.

That identity expansion belongs to the application layer. SEPT itself keeps the authorization primitive explicit and device-oriented.

## Recommendations for application developers

- Use stable namespaced event types, e.g. `message.send`, `files.offer`, `home.light.set`.
- Treat event types as capabilities, not merely logging labels.
- Grant the minimum event vocabulary required for a use case.
- Remember directionality: `A -> B` does not grant `B -> A`.
- Treat admin promotion as a security-sensitive operation.
- Keep protocol system-event types reserved for SEPT.
