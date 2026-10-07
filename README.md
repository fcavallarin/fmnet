# FMNet

FMNet is a device-to-device application built on [SEPT](https://github.com/fcavallarin/sept).

It adds application-level features on top of SEPT:

- private messaging;
- application-defined remote actions;
- peer-to-peer WebRTC data channels;
- TCP tunnelling over WebRTC.

SEPT provides device identity, pairing, encrypted event delivery, distributed ACLs, offline delivery and relay synchronization. FMNet gives those primitives application-level semantics and adds direct peer-to-peer communication.

The SEPT protocol, SDK, relay implementation, authorization model and security details are documented in the [SEPT repository](https://github.com/fcavallarin/sept) and are intentionally not duplicated here.

## See FMNet in action

![FMNet CLI demo](docs/demo/cli/fmnet-demo-quick.gif)

A trusted device can message another device, invoke an application-defined action, or expose a remote TCP service locally:

```text
message send apu "hello there"
run-action apu door-open
tunnel open apu 127.0.0.1 22 2222
```

Then use the tunnel as a normal local TCP endpoint:

```bash
ssh -p 2222 <username>@127.0.0.1
```

## Quick start

The easiest way to try FMNet is with two CLI instances representing two devices.

### Install

From the repository root:

```bash
npm install
npm run install:cli
```

### Start Device A

Run:

```bash
npm run cli
```

On first launch, choose a device name and create a new network:

```text
Insert your name: DeviceA

Device not paired
What do you want to do?
1. Create a new network
2. Join a network

Select option: 1
```

Device A becomes the first administrator of the network.

### Start Device B

In another terminal or on another machine:

```bash
npm run cli
```

Choose a different device name and join the existing network:

```text
Insert your name: DeviceB

Device not paired
What do you want to do?
1. Create a new network
2. Join a network

Select option: 2
```

Device B prints its pairing data as a base64-encoded value and also displays it as a QR code.

### Pair Device B

On Device A:

```text
fmnet> device add <b64-client-data>
```

Device A returns a short-lived PIN.

Enter that PIN on Device B to complete the pairing.

Pairing establishes the device relationship, but authorization is a separate step. Newly paired non-admin devices remain default-deny until the required capabilities are explicitly granted.

### Grant capabilities

Allow Device B to send messages to Device A:

```text
fmnet> device grant DeviceB DeviceA message
```

Allow Device B to open TCP tunnels on Device A:

```text
fmnet> device grant-tunnel DeviceB DeviceA
```

Application-defined actions use their own event types. For example:

```text
fmnet> device grant DeviceB DeviceA customaction.door-open
fmnet> device grant DeviceA DeviceB customaction.response
```

### Send a message

```text
fmnet> message send DeviceA "hello there"
```

### Run an action

```text
fmnet> run-action DeviceA door-open
```

### Open a TCP tunnel

Expose SSH on Device B as local port `2222` on Device A:

```text
fmnet> tunnel open DeviceB 127.0.0.1 22 2222
```

This maps:

```text
Device A                          Device B
127.0.0.1:2222                    127.0.0.1:22
       │                                ▲
       └──── TCP over WebRTC tunnel ────┘
```

Use the local endpoint normally:

```bash
ssh -p 2222 <username>@127.0.0.1
```

Run:

```text
fmnet> help
```

to list the commands supported by the current CLI.

## Architecture

FMNet sits above SEPT.

```text
┌──────────────────────┐                         ┌──────────────────────┐
│       Device A       │                         │       Device B       │
│                      │                         │                      │
│        FMNet         │                         │        FMNet         │
│          │           │                         │          │           │
│        SEPT          │                         │        SEPT          │
└──────────┬───────────┘                         └──────────┬───────────┘
           │                                                │
           └──────── encrypted events / signalling ─────────┘
                            via SEPT

           ┌────────────────────────────────────────────────┐
           │              WebRTC peer connection            │
           │  application DataChannels / TCP tunnel traffic │
           └────────────────────────────────────────────────┘
```

SEPT carries authenticated and authorized application events and is used by FMNet for signalling and control.

Once a WebRTC connection is established, FMNet can carry application traffic directly between peers.

The boundary is intentionally simple:

| Concern | Project |
| --- | --- |
| Device identity and network membership | SEPT |
| Pairing | SEPT |
| Encrypted event transport | SEPT |
| Authorization and distributed ACLs | SEPT |
| Offline event delivery | SEPT |
| Relay synchronization | SEPT |
| Messaging semantics | FMNet |
| Remote actions | FMNet |
| WebRTC integration | FMNet |
| Application DataChannels | FMNet |
| TCP tunnelling | FMNet |

## Messaging

Messaging is an FMNet application feature implemented using SEPT events.

SEPT handles transport, authentication, encryption, authorization and offline delivery. FMNet defines the message semantics and exposes them through the application and CLI.

A device must be explicitly authorized to send the corresponding event type to another device.

## Remote actions

FMNet supports application-defined remote actions.

For example:

```text
fmnet> run-action DeviceA door-open
```

The action itself is application-specific. Authorization is expressed using SEPT event types, so individual actions can be granted independently instead of giving a device broad remote-control access.

For example:

```text
customaction.door-open
customaction.response
```

## WebRTC and TCP tunnels

FMNet maintains a reusable WebRTC peer connection between two devices when direct communication is required.

A single peer connection can carry multiple independent DataChannels:

```text
Device connection
├── application DataChannel
├── TCP tunnel #1
│   ├── TCP socket #1 / DataChannel
│   └── TCP socket #2 / DataChannel
└── TCP tunnel #2
    └── TCP socket #1 / DataChannel
```

Each TCP socket uses its own DataChannel, while multiple sockets and tunnels can share the same underlying peer connection.

This allows ordinary TCP applications such as SSH or SCP to reach services on another FMNet device without exposing those services publicly.

## Local server

The CLI uses the public development relay by default.

For local development, FMNet also includes a Cloudflare Worker setup that can be run with Wrangler.

### Initialize the local database

Before starting the local server for the first time, or whenever you want a clean local database:

```bash
npm run server:init
```

This removes the existing local D1 state and reapplies the migrations. It only affects Wrangler's local state.

### Start the local server

```bash
npm run server
```

Keep this process running.

Wrangler normally exposes the Worker at:

```text
http://127.0.0.1:8787
```

### Run the CLI against the local server

Pass the local endpoint directly:

```bash
npm run cli -- http://127.0.0.1:8787
```

or set it through the environment:

```bash
FMNET_REST_ENDPOINT=http://127.0.0.1:8787 npm run cli
```

Without either value, the CLI uses the configured public development relay.

### Deploy Server to Cloudflare

The server can also be deployed to your own Cloudflare account using Wrangler, allowing you to run a private FMNet backend with your own Worker and D1 database instead of relying on the public development relay.

```bash
wrangler login
wrangler d1 migrations apply DB --remote
wrangler deploy
```

After deployment, point the FMNet CLI to your Worker URL using `FMNET_REST_ENDPOINT` or by passing the endpoint on the command line.

## Tests

The test suite uses the local FMNet/SEPT server and therefore requires the local server to already be running.

In the first terminal:

```bash
npm run server:init
npm run server
```

Keep the server running.

Then, in another terminal:

```bash
npm test
```

`npm test` runs the FMNet integration test suite. The tests create their own local client databases, exercise real server requests, pairing, authorization, messaging and WebRTC/TCP-tunnel behavior.

If you want a completely clean server state between runs, stop the server, run:

```bash
npm run server:init
```

and start it again:

```bash
npm run server
```

## CLI endpoint selection

The CLI chooses the server endpoint in this order:

1. endpoint passed on the command line;
2. `FMNET_REST_ENDPOINT`;
3. the built-in public development relay.

Examples:

```bash
npm run cli
FMNET_REST_ENDPOINT=http://127.0.0.1:8787 npm run cli
```

The CLI database name can also be overridden with `DBNAME`, which is useful when running multiple local devices from the same checkout:

```bash
DBNAME=device-a npm run cli
DBNAME=device-b npm run cli
```

## Project status

FMNet is under active development.

It is currently used to exercise:

- encrypted device-to-device messaging;
- explicit per-capability authorization;
- application-defined actions;
- IoT and remote-device control;
- reusable WebRTC peer connections;
- multiple concurrent TCP and SSH sessions;
- large SCP transfers.

The underlying SEPT protocol and implementation have not received an independent security audit. See the [SEPT repository](https://github.com/fcavallarin/sept) for its current security documentation and limitations.

## License

MIT
