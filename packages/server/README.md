# `@sept/server`

Reference SEPT relay/server package for Cloudflare Workers.

The server is intentionally not the application authorization authority. It authenticates registered device requests, coordinates pairing, accepts encrypted signed events, tracks pending delivery, assigns transport sequence values and exposes WebSocket push through a Durable Object.

## Exported server composition

```js
import { createSeptServer } from "@sept/server"
```

`createSeptServer(plugins, options)` returns a Worker-compatible object with `fetch()` and allows deployment code to add custom routes and install server hooks.

The package also exports `DORelay` for Wrangler Durable Object binding.

The reference Cloudflare deployment lives in `apps/worker`.

See:

- [`docs/architecture.md`](../../docs/architecture.md)
- [`docs/self-hosting.md`](../../docs/self-hosting.md)
- [`docs/security.md`](../../docs/security.md)
