# Security model

> **Important:** SEPT and FMNet are under active development and have not received an independent security audit. This document describes the current implementation and known assumptions; it is not a security certification.

## Goals

SEPT is designed to provide the following properties for trusted-device applications:

- device identities based on locally held cryptographic keys;
- authenticated event senders;
- encrypted application payloads in transit through the relay;
- per-recipient wrapped payload keys for multi-recipient events;
- local, directed application authorization policies;
- signed system events for policy/admin/device state changes;
- relay authentication of established devices for transport operations;
- a relay that is not the source of truth for application-event authorization.

## Cryptographic primitives

The current JavaScript implementation uses:

| Purpose | Primitive |
| --- | --- |
| Device signatures | Ed25519 |
| Key agreement | X25519 |
| KDF | HKDF-SHA256 |
| Authenticated encryption | XChaCha20-Poly1305 |
| Hashing / IDs | SHA-256 |

The implementation uses the Noble JavaScript cryptography packages.

## Key model

Each device has separate signing and encryption key pairs.

Private keys are generated client-side and are not intentionally sent to the relay. Device public keys are distributed through bootstrap/pairing/system events and persisted locally.

The relay stores the signing public key for transport request authentication and relay-facing signature verification.

## What the relay can and cannot see

### Encrypted from the relay

The application event object `{type,payload}` is encrypted with a fresh symmetric payload key. Each recipient's copy of that payload key is wrapped using X25519-derived key material.

The relay therefore does not need the plaintext application payload to route or persist an event.

### Metadata visible to the relay

A relay necessarily observes or stores transport metadata including some combination of:

- network ID;
- sender device ID;
- recipient device IDs;
- device signing public keys;
- event identifier;
- timestamp and arrival timing;
- relay-assigned sequence;
- ciphertext and wrapped-key sizes;
- connection/IP/platform metadata available to the hosting infrastructure.

SEPT is not a traffic-analysis-resistant or metadata-hiding system.

### Event-type confidentiality

The current `sendEvent()` implementation encrypts `{type,payload}` and does **not** include the application event type as a top-level field in the relay POST body. The reference relay can route and persist the event without learning the plaintext event type.

This does not make SEPT metadata-hiding: event sizes, sender/recipient relationships, timestamps, delivery timing and other transport metadata remain observable and may still correlate with application behavior.

## Event authenticity

The sender signs canonical serialized event material with Ed25519.

The current implementation maintains two signatures:

- a relay-facing signature including `eventId` and the full recipient list, verified by the relay;
- a recipient-facing signature including `eventId` but using an empty recipient list, verified after receipt.

A recipient verifies the sender signature before decrypting/dispatching the event. This cryptographically binds the received `eventId`, sender identity, encrypted payload and timestamp to the sender signature.

The sender currently derives `eventId` from canonical wire material containing the full recipient list before signing it. An individual recipient cannot independently recompute that derivation because the relay delivers only that recipient's wrapped payload key, not the full recipient list. The reference server likewise verifies the relay-facing signature but does not currently recompute the ID.

As a result, a malicious relay cannot substitute a different `eventId` without breaking the recipient-facing signature, while deterministic event-ID derivation remains a sender-side convention rather than an independently enforced invariant.

## Sequence/order trust

The relay assigns `sequence` when accepting events. The recipient uses it for ordering/history, but it is not currently end-to-end signed by the sender.

Therefore sequence is a **relay-provided ordering service**, not cryptographic proof of sender order. A malicious/buggy relay can affect delivery order, delay or omit events, or assign unexpected sequence values.

## Application authorization

SEPT uses local directed policies:

```text
source device -> destination device -> allowed event types
```

A non-admin sender is default-deny unless the event type is allowed by the local edge policy.

Recipients perform an independent policy check after verifying/decrypting the event and before invoking application handlers.

The relay cannot legitimately grant a sender a new application event type merely by changing relay-side transport state; the recipient's local policy still needs to allow it.

Admins are privileged and currently bypass ordinary `allowedEventTypes` checks.

## System events

Policy, admin and device lifecycle changes are distributed as reserved `sept.*` events.

The receive pipeline applies system-event handlers only when the sender is locally recognized as an admin. A failed system event is intentionally not silently skipped/ACKed, so subsequent synchronization can fail again until the root cause is addressed.

This behavior favors consistency over availability for protocol state changes.

## Pairing trust bootstrap

Pairing deserves special treatment because a brand-new device has no previously trusted admin key.

Current flow:

1. the joining device generates its own keys locally;
2. an existing admin creates a relay pairing with a short-lived PIN;
3. the admin encrypts network/admin bootstrap material to the joining device;
4. the joining device redeems `(deviceId, PIN)` at the relay;
5. the relay returns the encrypted bootstrap payload;
6. the joining device installs the included admin public keys as its initial trust state.

At step 4/5, the joining device is relying on the relay to enforce that the pairing record was created through an authenticated admin flow. This is an explicit **initial trust-bootstrap dependency on the relay**.

After pairing, signed local admin state becomes the trust anchor for normal protocol system events.

### Pairing PIN properties

Pairing requires both a a freshly generated device ID and a numeric PIN. The device ID is derived from freshly generated device key material and is not practically guessable.

A pending pairing can be redeemed only once. An incorrect PIN destroys the pending pairing record. A correct PIN atomically marks the pairing as redeemed,
preventing further redemption attempts while keeping the record available for the initiating admin to retrieve its completion payload.

If pairing fails, the joining device restarts enrollment with fresh key material and therefore a new device ID.

An attacker who learns a pending device ID consequently gets only a single PIN guess against that specific pairing session. After an incorrect guess, targeting a subsequent pairing requires discovering the newly generated device ID again.

With a short expiration window, this prevents conventional online PIN brute forcing even with a short numeric PIN. An attacker able to repeatedly observe newly generated pairing identifiers could still disrupt enrollment by racing legitimate pairing attempts; this is an availability attack rather than an authentication bypass.


## Relay request authentication

Established-device REST requests use signed SEPT request headers. The server recovers the device ID, loads its signing public key and verifies the request signature.

The server also checks relay-side admin/network constraints for privileged transport operations such as pairing creation, admin changes and invalidation.

### Bootstrap endpoint

Network bootstrap occurs before an established device can authenticate against server state. The current bootstrap endpoint accepts the newly generated network ID, root device ID and root signing public key and creates the initial records.

The security assumption here is that generated identifiers are unguessable enough to prevent practical preemption/collision and that the endpoint is protected operationally against abuse/resource exhaustion. A production-hardening pass should explicitly review bootstrap abuse controls.

## Availability and malicious relay

SEPT does not make an untrusted relay magically available or fair. A malicious or compromised relay can:

- drop events;
- delay events;
- refuse connections;
- selectively withhold pending events;
- manipulate relay-assigned sequence/order;
- observe transport metadata;
- interfere with initial pairing bootstrap;
- attempt duplicate/delivery-bookkeeping manipulation.

Payload encryption and local policy checks limit what the relay can learn/authorize, but they do not solve availability.

## Local device compromise

If an attacker obtains a device's private keys and local SEPT state, that device identity should be considered compromised until invalidated and keys/trust state are rotated as required.

Current device invalidation distributes `sept.device.invalidate`, updates relay-side revoked state and marks the device revoked locally. Full network-wide key-rotation/recovery semantics are still an area that should be treated as evolving pre-1.0 behavior.

## Local storage

The client stores protocol state in SQLite. Secret settings support a configurable secret-key provider, but host applications are responsible for choosing appropriate secure storage and device OS protections.

Applications should review:

- whether private key values are encrypted at rest on the target platform;
- backup behavior;
- device lock/biometric policy;
- debug logging;
- crash reporting/telemetry;
- rooted/jailbroken device assumptions.

## Replay and duplicate behavior

The relay maintains per-recipient pending rows and ACK deletion. Clients also persist event IDs and reject/handle unexpected duplicate states.

`eventId` is now cryptographically bound to the sender signature verified by recipients, which prevents a relay from silently substituting the identifier used for ACK/deduplication.

Replay and duplicate handling is nevertheless still under active development. Explicit protocol tests should cover duplicate delivery, an event received-but-not-yet-ACKed, self-addressed events, retry behavior and server-side pending-row cleanup before production-security claims are made.

## Side channels and non-goals

The current implementation does not aim to hide:

- traffic timing;
- relationship graph inferred from sender/recipient traffic;
- event sizes;
- IP/network metadata;
- online/offline connection state from the relay provider.

It is also not intended to provide anonymity against the relay.

## Current hardening checklist

Before a stable/security-sensitive release, consider making these items explicit release blockers or tracked issues:

- add regression coverage that the relay-facing event body does not expose plaintext `type`;
- add tamper tests proving that changing only `eventId` fails relay and recipient signature verification;
- decide whether deterministic `eventId` derivation should be independently recomputed/enforced by the server or remain a sender convention;
- document and test replay/duplicate behavior;
- consider optional pairing rate limits for availability/abuse protection;
- review bootstrap abuse/preemption protections;
- make relay ordering assumptions explicit;
- add transactional local event + recipient persistence;
- define schema migrations for long-lived mobile installations;
- define compromised-device/key-rotation recovery behavior;
- independent cryptographic/protocol review.

## Reporting security issues

Until a dedicated private security reporting process is published, avoid posting exploit details for a serious vulnerability in a public issue. Contact the maintainer privately first and coordinate disclosure.
