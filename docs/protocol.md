# SEPT protocol overview

> **Status:** implementation-oriented, pre-1.0 documentation. This is not yet a normative RFC and wire compatibility is not guaranteed across unreleased revisions.

SEPT is built around **typed encrypted events between device identities**. Devices keep private keys locally, learn other devices' public keys through bootstrap/pairing and signed system events, and evaluate authorization from local directed policies.

## Identities

Each device has two key pairs:

- **Ed25519** signing key pair;
- **X25519** encryption/key-agreement key pair.

Device IDs are derived from signing public-key material in the current implementation. Network and event IDs use deterministic/hash-based helpers where applicable.

Private keys remain in client-side storage. The relay stores signing public keys required to authenticate requests and verify relay-facing event signatures.

## Canonical serialization

SEPT uses canonical JSON when data must have a stable serialized representation for encryption/signing/ID derivation.

The common event serialization helper is conceptually:

```js
canonicalJson({
  networkId,
  recipients,
  senderDeviceId,
  body,
  ts,
})
```

Binary values transported in JSON are base64url encoded.

## Application event payload

An application event starts as:

```js
{
  type: "message.send",
  payload: {
    text: "hello"
  }
}
```

`type` is the authorization/dispatch vocabulary. `payload` belongs to the application.

System events use the reserved `sept.*` namespace.

## Sending an event

For each outgoing event the client currently performs the following steps.

### 1. Resolve and authorize recipients

The client loads recipient device public keys from local storage and checks the directed policy:

```text
(senderDeviceId, recipientDeviceId, eventType)
```

Admins currently bypass ordinary application policy checks.

### 2. Create a fresh payload key

A random 32-byte symmetric payload key is generated for the event.

### 3. Encrypt `{type, payload}`

The canonical JSON representation of the application event is encrypted with **XChaCha20-Poly1305** using the payload key and a random 24-byte nonce.

Wire representation is a base64url string containing nonce + authenticated ciphertext.

### 4. Wrap the payload key per recipient

For each recipient:

1. sender X25519 private key + recipient X25519 public key derive a shared secret;
2. HKDF-SHA256 derives a wrap key using the per-wrap nonce as salt and the current domain-separation info string;
3. XChaCha20-Poly1305 encrypts the payload key;
4. nonce + ciphertext are base64url encoded as `encryptedPayloadKey`.

This allows one encrypted payload to be addressed to multiple recipients while each recipient receives its own wrapped payload key.

### 5. Sign event material

The sender creates two Ed25519 signatures in the current implementation:

- an end-recipient signature over serialized event material without the recipient list;
- a relay-facing signature over serialized event material including recipients.

The relay-facing signature lets the relay reject a request whose recipient list/encrypted payload was not signed by the authenticated sender.

The recipient signature lets a recipient verify sender authenticity and ciphertext integrity independently of relay-side recipient routing.

### 6. Store locally and submit

The sender stores an outgoing event locally, then sends the encrypted representation to the relay.

The current request body includes fields conceptually equivalent to:

```js
{
  eventId,
  type,
  senderDeviceId,
  encryptedPayload,
  recipients: [
    { deviceId, encryptedPayloadKey }
  ],
  timestamp,
  signature,
  relaySignature,
}
```

**Current implementation caveat:** `type` is already inside the encrypted payload but is also present as a top-level request field. The relay server does not currently use that field, but a relay can observe it. If event-type confidentiality is intended, the redundant plaintext field should be removed. See [Security](security.md).

## Relay processing

For established devices, relay HTTP requests are signed by the device and authenticated against the device signing public key stored in D1.

When receiving an event, the relay:

1. authenticates the request/device;
2. checks that the authenticated device matches `senderDeviceId`;
3. verifies the relay-facing event signature;
4. increments a network-wide/current server event sequence counter;
5. stores the encrypted event;
6. creates one pending row per recipient with that recipient's wrapped payload key;
7. pushes the recipient-specific event through the network Durable Object if the recipient is connected;
8. emits a server-side `event.received` plugin event.

The relay does not need the plaintext application payload to route the event.

## Receiving an event

The recipient receives an object containing the shared encrypted payload plus its recipient-specific encrypted payload key.

The client then:

1. resolves the sender from local trusted device state;
2. verifies the Ed25519 sender signature;
3. unwraps the payload key using recipient private X25519 key + sender public X25519 key;
4. decrypts and parses `{type,payload}`;
5. evaluates the sender-to-recipient local policy for `type`;
6. persists the event;
7. routes SEPT system events or invokes a registered application handler;
8. ACKs the event to the relay.

A policy-denied application event is not delivered to the application handler.

## Synchronization and delivery

SEPT supports two receive paths that converge on the same event-processing pipeline:

- **WebSocket push** after `connect()`;
- **pull synchronization** through `sync()` / polling.

The relay stores pending delivery state per `(recipient,event)` until ACK.

ACK removes the recipient's pending row. When no pending rows remain for an event, the current server implementation can delete the shared encrypted event row.

## Ordering

The relay assigns a monotonically increasing `sequence` value when accepting an event. Pending events are returned ordered by sequence.

Sequence is relay-managed transport ordering; it is not currently an end-to-end signed field. Applications should not interpret it as a cryptographically trusted statement from the sender.

## Event IDs

The current sender derives an `evt_*` ID from canonical serialized local event material before relay submission. Recipients use the relay-provided `eventId` for persistence/deduplication/ACK.

At the current implementation stage, `eventId` is **not included in the end-to-end signature verified by recipients**. A malicious relay cannot change the encrypted payload without breaking the sender signature, but it could alter the identifier used for delivery bookkeeping. This should be reviewed before calling event IDs cryptographically bound identifiers.

## System event namespace

Current SEPT system event types include:

```text
sept.policy.update
sept.admin.grant
sept.admin.revoke
sept.device.add
sept.device.invalidate
```

These are handled internally rather than through application `register()` handlers.

A received system event is applied only when the sender is locally recognized as an admin. Protocol events are treated as non-skippable: if processing fails, the client avoids ACKing the failing event so the next synchronization can retry it.

## Pairing

### Device initialization

A joining device runs `initDevice()` to create signing/encryption key pairs and derives its device ID.

The joining device's public data is supplied to an existing admin through the application/out-of-band UX.

### Admin creates pairing

The admin creates a short-lived PIN and asks the relay to store a pairing record containing:

- device/network identifiers;
- joining-device signing public key;
- initiator admin device ID;
- admin X25519 public key;
- an encrypted payload for the joining device;
- a separate encrypted admin payload for pairing completion.

The joining-device payload contains network identity, current admin public keys and optional application metadata. The relay stores it as an opaque encrypted blob.

The admin completion payload is encrypted so the relay does not need to see admin-side application metadata.

### New device redeems PIN

The new device presents `(deviceId, pin)` to the relay. The relay marks the pairing redeemed, registers the device for transport, and returns the encrypted joining-device payload.

The new device decrypts it and installs the network plus current admin public keys as its initial trust state.

### Initiating admin completes

The initiating admin polls redeemed pairings. The server only returns completion records initiated by that authenticated admin. After decrypting the admin payload, the initiator stores the new device, deletes the pairing record, and notifies other admins through `sept.device.add`.

## Request authentication

After a device is registered, REST requests are authenticated with SEPT request headers/signatures generated by the client and verified against the device signing public key in D1.

This relay authentication is distinct from application-event authorization. The relay decides whether a request comes from a registered transport identity; the recipient client decides whether the sender is permitted to perform a specific application event.

## Protocol vs FMNet

The following are not intrinsic SEPT wire-protocol concepts:

- chat conversations;
- WebRTC SDP/ICE semantics;
- TCP tunnels;
- remote shell behavior;
- custom FMNet actions;
- Expo push UX.

Those are application features that can use SEPT events for authenticated/authorized coordination.
