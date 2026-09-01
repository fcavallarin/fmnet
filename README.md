# SEPT / FMNet

> Private communication and trusted-device networking.

**SEPT** is a privacy-first protocol and JavaScript SDK for sending typed, encrypted events between trusted devices through a relay that is not part of the application authorization model.

**FMNet** is an application built on SEPT. It adds private messaging, application-defined remote actions, peer-to-peer WebRTC data channels, and TCP tunnelling over WebRTC.

| Project | What it is |
| --- | --- |
| **SEPT** | Device identity, pairing, encrypted events, local authorization policies, persistence, relay synchronization and connection lifecycle. |
| **FMNet** | A real application and integration test for SEPT: chat, remote actions, WebRTC connections and TCP tunnels. |

Start here:

- [SEPT quick start](docs/sept-quickstart.md)
- [Architecture](docs/architecture.md)
- [Protocol overview](docs/protocol.md)
- [Authorization model](docs/authorization.md)
- [Security model and current limitations](docs/security.md)
- [Self-hosting the relay](docs/self-hosting.md)
- [SEPT client API](docs/api.md)

> **Project status:** SEPT and FMNet are under active development. The protocol and implementation have not received an independent security audit. See [Security](docs/security.md) before using the project in a high-risk environment.

---

## See FMNet in action

![FMNet CLI demo](docs/demo/cli/fmnet-demo-quick.gif)

A trusted device can message another device, invoke an application-defined action, or open a TCP tunnel to a private service:

```text
message send apu "hello there"
run-action apu door-open
tunnel open apu 127.0.0.1 22 2222
ssh -p 2222 127.0.0.1
```

SEPT is the event and authorization layer underneath those operations; WebRTC/TCP tunnelling is an FMNet feature built on top.

---

## Architecture at a glance

```text
┌──────────────────────┐                         ┌──────────────────────┐
│       Device A       │                         │       Device B       │
│                      │                         │                      │
│  FMNet / your app    │                         │  FMNet / your app    │
│          │           │                         │          │           │
│      SEPT client     │                         │      SEPT client     │
│   keys + policies    │                         │   keys + policies    │
│   local event store  │                         │   local event store  │
└──────────┬───────────┘                         └──────────┬───────────┘
           │ signed request                                 │ signed request
           │ encrypted event                                │ encrypted event
           ▼                                                ▼
                    ┌────────────────────────┐
                    │      SEPT relay        │
                    │ Cloudflare Worker/D1   │
                    │ R2 / Durable Object    │
                    │                        │
                    │ routing + pending      │
                    │ events + sequencing    │
                    └────────────────────────┘
```

Private signing and encryption keys stay on devices. Authorization decisions for application events are evaluated from policies stored locally by SEPT clients rather than delegated to the relay.

The relay necessarily observes transport metadata such as device/network identifiers, timing and event sizes. See [Security](docs/security.md) for the exact current confidentiality boundary and implementation caveats.

---

## Quick start: run FMNet

The easiest way to exercise the complete stack today is the FMNet CLI. The development configuration can use the public development relay, so initial testing does not require deploying Cloudflare resources.

### Install

```bash
./install.sh cli
```

### Run

```bash
./run.sh
```

Use two terminals or two machines:

- **Device A** creates a network.
- **Device B** initializes a device and joins through explicit pairing.

```text
$ ./run.sh

Insert your name: DeviceB

What do you want to do?
1. Create a new network
2. Join a network

Select option:
```

### Pair Device B

On the admin device:

```text
fmnet> device add <b64-client-data>
```

The CLI returns a short-lived PIN. Enter that PIN on Device B to complete the pairing flow.

### Grant application capabilities

SEPT is default-deny for non-admin devices. Pairing adds a device to the trust graph; it does not automatically authorize arbitrary application events.

Allow Device B to send messages to Device A:

```text
fmnet> device grant DeviceB DeviceA message
```

Allow Device B to open a TCP tunnel on Device A:

```text
fmnet> device grant-tunnel DeviceB DeviceA
```

For application-defined actions, grant the corresponding event types as required by the application:

```text
fmnet> device grant DeviceA DeviceB customaction.response
fmnet> device grant DeviceB DeviceA customaction.door-open
```

List available commands:

```text
fmnet> help
```

For direct SDK usage, see [SEPT quick start](docs/sept-quickstart.md).

---

## TCP tunnels

TCP tunnelling is an **FMNet feature**, not part of the SEPT wire protocol.

Expose SSH on Device B as local port `2222` on Device A:

```text
fmnet> tunnel open DeviceB 127.0.0.1 22 2222
```

```text
Device A                          Device B
127.0.0.1:2222                    127.0.0.1:22
       │                                ▲
       └──── TCP over WebRTC tunnel ────┘
```

Then connect normally:

```bash
ssh -p 2222 <username>@127.0.0.1
```

FMNet maintains a reusable WebRTC peer connection when needed. Each TCP socket uses its own WebRTC DataChannel, so multiple TCP sessions can share one peer connection concurrently.

```text
Device connection / DataChannelManager
├── TCP tunnel #1
│   ├── TCP socket #1 / DataChannel
│   └── TCP socket #2 / DataChannel
├── TCP tunnel #2
│   └── TCP socket #1 / DataChannel
└── application DataChannels
```

---

## Repository map

```text
packages/
├── client/   @sept/client  — SEPT client, local stores, pairing, policies, sync and WS lifecycle
├── core/     @sept/core    — canonical JSON, serialization, IDs, queues, event bus, SQL adapters
├── crypto/   @sept/crypto  — signing, hashing, symmetric/asymmetric encryption primitives
└── server/   @sept/server  — relay HTTP routes, request authentication and Durable Object relay

apps/
├── worker/   — Cloudflare Worker composition/deployment of @sept/server
└── fmnet/    — FMNet application, CLI and mobile client
```

The monorepo is intentional: FMNet acts as a real consumer of SEPT and exercises the protocol across Node.js, React Native/Expo and Cloudflare Workers.

---

## Why plain JavaScript?

SEPT is written in **plain JavaScript** deliberately. Portability is a project requirement, and the same code is intended to run across:

- Node.js;
- browsers;
- React Native and Expo;
- Cloudflare Workers.

Avoiding a mandatory compile step also keeps the protocol implementation easy to inspect and embed. Type declarations can describe the public API without changing the runtime implementation.

---

## Public relay and self-hosting

The public development relay is intended for development and testing while the project is evolving.

For control over availability, retention and transport metadata, deploy your own relay. The reference deployment uses:

- Cloudflare Workers;
- D1;
- Durable Objects;
- R2 (binding present in the reference worker; usage may evolve with attachments/event storage).

See [Self-hosting](docs/self-hosting.md) for the current deployment steps and configuration notes.

---

## Current status

The implementation is actively dogfooded and has been exercised with:

- encrypted messaging between paired devices;
- application-defined events/actions;
- local capability enforcement;
- multiple concurrent SSH sessions;
- large SCP transfers;
- multiple TCP sockets over a reusable WebRTC peer connection;
- mobile push integration;
- remote deployment.

Current work is focused on real-world testing, bug fixing, documentation, API stabilization and broader compatibility testing.

---

## Security notice

SEPT and FMNet have **not received an independent security audit**.

Do not treat the current implementation as a finished security product. Review the protocol, key lifecycle, pairing trust bootstrap, relay configuration, local storage and application authorization model for your threat model.

Read [docs/security.md](docs/security.md) for the current guarantees, non-goals and known implementation caveats.

---

## Contributing

The project is still evolving quickly. Bug reports, architecture feedback, interoperability experiments, platform compatibility reports and real-world test results are welcome.

For substantial changes, open an issue first and describe the intended use case and protocol/API impact.

---

## License

MIT
