# `@sept/client`

Cross-runtime SEPT client implementation.

It currently combines the practical protocol runtime needed by applications:

- device/network bootstrap;
- key generation and local identity;
- pairing;
- typed encrypted events;
- local authorization policies;
- admin/device lifecycle;
- SQLite-backed persistence;
- REST synchronization;
- WebSocket relay connection;
- application event registration/dispatch;
- namespaced application KV storage.

The project intentionally has not frozen a separate `proto` vs `sdk` package boundary yet.

## Usage

```js
import { SeptClient } from "@sept/client"

const sept = await SeptClient.create({
  restEndpoint: "http://localhost:8787",
  dataStore: {
    type: "better-sqlite",
    open,
    close,
  },
})
```

See the repository documentation:

- [`docs/sept-quickstart.md`](../../docs/sept-quickstart.md)
- [`docs/api.md`](../../docs/api.md)
- [`docs/protocol.md`](../../docs/protocol.md)
- [`docs/authorization.md`](../../docs/authorization.md)
- [`docs/security.md`](../../docs/security.md)
