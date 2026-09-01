# SEPT Cloudflare Worker

Reference Cloudflare deployment for `@sept/server` plus FMNet-specific server plugins.

Core SEPT relay behavior comes from:

```js
import { createSeptServer } from "@sept/server"
export { DORelay } from "@sept/server"
```

The current worker also demonstrates FMNet mobile push integration through a custom route and the `event.received` server event.

## Bindings

- `DB` — Cloudflare D1
- `RELAY` — `DORelay` Durable Object
- `MAILBOX` — R2 bucket configured by the reference deployment

## Local development

From the repository root:

```bash
npm install
cd apps/worker
npx wrangler d1 migrations apply DB --local
npm run dev
```

## Deploy

Create your own D1/R2 resources and update `wrangler.jsonc` first. Do not reuse the checked-in development D1 database ID.

```bash
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

For complete setup and security notes, see [`docs/self-hosting.md`](../../docs/self-hosting.md).
