# `@sept/server`

Reference SEPT relay/server package for Cloudflare Workers.

The server is intentionally not the application authorization authority. It authenticates registered device requests, coordinates pairing, accepts encrypted signed events, tracks pending delivery, assigns transport sequence values and exposes WebSocket push through a Durable Object.

## Exported server composition

```js
import { createSeptServer } from "@sept/server"
```

`createSeptServer(plugins, options)` returns a Worker-compatible object with `fetch()` and allows deployment code to add custom routes and subscribe to server events.

The package also exports `DORelay` for Wrangler Durable Object binding.

## Core routes

```text
POST   /bootstrap
POST   /event
GET    /events
PATCH  /events
POST   /devices/create-pairing
GET    /devices/pairing/:id/:pin
GET    /paired-devices
DELETE /paired-devices/:deviceId
PATCH  /devices/set-admin
POST   /devices/invalidate
GET    /get-relay-ticket
GET    /ws
```

## Plugin example

```js
export default createSeptServer(
  [
    {
      routes: [
        { method: "POST", path: "/my-route", handler },
      ],
      events: {
        "event.received": async ({ env, eventData }) => {
          // application integration
        },
      },
    },
  ],
  {
    maxNetworks: 1,
  }
)
```

The reference Cloudflare deployment lives in `apps/worker`.

See:

- [`docs/architecture.md`](../../docs/architecture.md)
- [`docs/self-hosting.md`](../../docs/self-hosting.md)
- [`docs/security.md`](../../docs/security.md)
