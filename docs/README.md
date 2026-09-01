# SEPT / FMNet documentation

This directory documents the current implementation and intended architecture of SEPT and FMNet.

SEPT is still pre-1.0. Unless a document explicitly says otherwise, these files describe the **current implementation**, not a frozen wire-protocol specification.

## Start here

1. [SEPT quick start](sept-quickstart.md) — use the JavaScript client directly.
2. [Architecture](architecture.md) — understand the trust and component boundaries.
3. [Protocol](protocol.md) — event, pairing and synchronization flow.
4. [Authorization](authorization.md) — local default-deny policies and admin events.
5. [Security](security.md) — guarantees, metadata exposure, trust assumptions and known gaps.
6. [Self-hosting](self-hosting.md) — deploy the Cloudflare relay.
7. [Client API](api.md) — public `SeptClient` surface.

## SEPT vs FMNet

**SEPT** provides trusted-device identity, pairing, encrypted typed events, signed protocol events, local authorization state, persistence and relay synchronization.

**FMNet** is an application built on SEPT. Messaging, WebRTC peer connections, application-defined remote actions and TCP tunnelling belong to FMNet rather than to the SEPT wire protocol.

## Documentation policy

When implementation and documentation disagree, treat the code as authoritative until the discrepancy is fixed. Security-relevant discrepancies should be documented explicitly rather than papered over.
