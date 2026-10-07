# FMNet architecture

FMNet is an application built on [SEPT](https://github.com/fcavallarin/sept).

This document covers FMNet-specific behavior only. SEPT protocol details, device identity, pairing internals, relay synchronization, encryption and distributed ACL evaluation are documented in the SEPT repository.

## Overview

FMNet uses SEPT for asynchronous authenticated events and authorization.

It adds:

- private messaging;
- application-defined remote actions;
- WebRTC connection establishment;
- application DataChannels;
- TCP tunnelling over WebRTC.

```text
                    SEPT relay
                       ▲   ▲
                       │   │
                 FMNet signalling
                       │   │
┌──────────────────────┴─┐ ┌─┴──────────────────────┐
│       Device A         │ │       Device B         │
│                       │ │                        │
│  FMNet                │ │  FMNet                 │
│  ├── messaging        │ │  ├── messaging         │
│  ├── remote actions   │ │  ├── remote actions    │
│  ├── WebRTC manager   │ │  ├── WebRTC manager    │
│  └── TCP tunnels      │ │  └── TCP tunnels       │
│           │           │ │           │            │
│         SEPT          │ │         SEPT            │
└───────────┬───────────┘ └───────────┬────────────┘
            │                         │
            └──── WebRTC DataChannels ┘
```

## Pairing and authorization

FMNet uses SEPT's device pairing and authorization model rather than defining a separate trust mechanism.

From the FMNet CLI, a new device supplies its pairing data to an administrator:

```text
fmnet> device add <b64-client-data>
```

The administrator receives a short-lived PIN, which is entered on the joining device.

Pairing and authorization are separate operations. A paired non-admin device remains default-deny until the required event types are granted.

Examples:

```text
fmnet> device grant DeviceB DeviceA message
fmnet> device grant-tunnel DeviceB DeviceA
fmnet> device grant DeviceB DeviceA customaction.door-open
```

The exact SEPT policy format and authorization algorithm are intentionally not duplicated here.

## Messaging

FMNet messages are application-level SEPT events.

SEPT is responsible for secure delivery and authorization; FMNet is responsible for interpreting and exposing the message functionality.

## Remote actions

Remote actions are application-defined operations represented by explicit event types.

This allows individual capabilities to be granted independently instead of giving a device unrestricted remote-control access.

For example:

```text
customaction.door-open
```

can be granted independently from messaging or TCP tunnelling.

## WebRTC

SEPT events are used for the control/signalling path needed by FMNet.

Once a WebRTC peer connection has been established, peer-to-peer DataChannels carry direct application traffic.

A connection can be reused for multiple DataChannels instead of renegotiating a new peer connection for every operation.

## TCP tunnelling

FMNet maps a local TCP listener to a TCP endpoint reachable from another FMNet device.

Example:

```text
Device A                          Device B
127.0.0.1:2222                    127.0.0.1:22
       │                                ▲
       │                                │
       └── local TCP ─ DataChannel ─ TCP┘
```

The tunnel can be opened with:

```text
fmnet> tunnel open DeviceB 127.0.0.1 22 2222
```

and used with an ordinary TCP client:

```bash
ssh -p 2222 <username>@127.0.0.1
```

Each TCP connection gets its own WebRTC DataChannel.

Multiple sockets and multiple tunnels can therefore share a single WebRTC peer connection.

## FMNet / SEPT boundary

| Concern | Project |
| --- | --- |
| Device identity | SEPT |
| Pairing protocol | SEPT |
| Encrypted event transport | SEPT |
| Event authorization / ACLs | SEPT |
| Relay and offline delivery | SEPT |
| Messaging semantics | FMNet |
| Remote actions | FMNet |
| WebRTC integration | FMNet |
| Application DataChannels | FMNet |
| TCP tunnelling | FMNet |

The FMNet repository should reference SEPT for protocol-level documentation rather than carrying a second copy of it.
