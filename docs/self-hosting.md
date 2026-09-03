# Self-hosting the SEPT relay

The reference relay runs on Cloudflare and is composed from `@sept/server` by `apps/worker`.

This guide reflects the current repository layout. Cloudflare resource IDs in the checked-in `wrangler.jsonc` belong to the development deployment and must be replaced for an independent deployment.

## Requirements

- Node.js/npm
- a Cloudflare account
- Wrangler authenticated to that account

Install workspace dependencies from the repository root:

```bash
npm install
```

Then work from:

```bash
cd apps/worker
```

## Cloudflare resources

The current Worker configuration expects:

| Binding | Resource | Purpose |
| --- | --- | --- |
| `DB` | D1 | networks, devices, pairings, encrypted events, pending delivery, push tokens |
| `RELAY` | Durable Object | live WebSocket delivery per SEPT network |
| `MAILBOX` | R2 | configured reference bucket; storage usage is evolving |

The Worker enables the `nodejs_compat` compatibility flag and exports `DORelay` from `@sept/server`.

## 1. Create the D1 database

Create your database, for example:

```bash
npx wrangler d1 create sept
```

Wrangler prints a database ID. Update `apps/worker/wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "sept",
    "database_id": "<YOUR_DATABASE_ID>"
  }
]
```

Do not reuse the repository's checked-in development `database_id` for your deployment.

## 2. Create the R2 bucket

The current configuration declares:

```jsonc
{
  "binding": "MAILBOX",
  "bucket_name": "sept"
}
```

Create it:

```bash
npx wrangler r2 bucket create sept
```

If you choose another bucket name, update `wrangler.jsonc` accordingly.

At the current stage, core event routing is D1/Durable-Object based; treat R2 usage as part of the evolving reference deployment rather than a fixed protocol requirement.

## 3. Durable Object configuration

`wrangler.jsonc` binds:

```jsonc
"durable_objects": {
  "bindings": [
    {
      "name": "RELAY",
      "class_name": "DORelay"
    }
  ]
}
```

and contains the initial SQLite Durable Object migration. Normally Wrangler applies the DO class migration as part of deployment; you do not create a separate named DO instance manually. Instances are derived by the server from the SEPT network ID.

## 4. Apply D1 migrations

The repository currently contains:

```text
migrations/0001_initial.sql
migrations/0002_push_token.sql
```

For local development:

```bash
npx wrangler d1 migrations apply DB --local
```

For the remote D1 database:

```bash
npx wrangler d1 migrations apply DB --remote
```

Prefer Wrangler's migration command over the legacy `scripts/db_migrate.sh`; that helper currently references an older database name and only the initial migration.

## 5. Run locally

After applying local migrations:

```bash
npm run dev
```

or from the monorepo root:

```bash
npm run dev:worker
```

The default `SeptClient` endpoint is `http://localhost:8787`, matching a normal local Wrangler development flow.

## 6. Deploy

```bash
npm run deploy
```

Wrangler will print the deployed Worker URL, typically of the form:

```text
https://<worker>.<account-subdomain>.workers.dev
```

## 7. Point clients at your relay

Configure `SeptClient.create()` with the deployed origin:

```js
const sept = await SeptClient.create({
  restEndpoint: "https://<your-worker>.workers.dev",
  dataStore: {
    // platform-specific datastore configuration
  },
})
```

`connect()` derives `wss://` from the same endpoint and connects to `/ws` after obtaining a relay ticket.

## Current relay routes

The core `@sept/server` currently provides:

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

Except for initial bootstrap/pairing redemption phases as required by the protocol flow, established-device operations use SEPT signed-request authentication.

## Worker plugins

`createSeptServer()` accepts plugins that can add HTTP routes and subscribe to server events.

The reference FMNet Worker currently demonstrates:

- `POST /register-push-token`
- an `event.received` hook that can trigger an Expo push notification for the recipient device.

This is an **FMNet/application deployment concern**, not a requirement for a generic SEPT relay. A standalone SEPT deployment can remove or replace these plugins while keeping the core server.

Conceptually:

```js
export default createSeptServer([
  {
    routes: [
      { method: "POST", path: "/my-route", handler },
    ],
    events: {
      "event.received": async ({ env, eventData }) => {
        // application-specific integration
      },
    },
  },
], options)
```

### Network bootstrap limit

`createSeptServer()` accepts a `maxNetworks` option controlling how many SEPT networks may be bootstrapped on that server:

```js
export default createSeptServer(
  plugins,
  {
    maxNetworks: 1
  }
)
```

The default is `1`, which is appropriate for a typical single-network self-hosted deployment.

Once the configured number of networks exists, further `POST /bootstrap` requests are rejected. Shared or public relay operators can explicitly configure a higher value based on the intended deployment and available resources.

Because bootstrap is intentionally unauthenticated, `maxNetworks` also acts as a basic resource-exhaustion safeguard. Public permissionless deployments may still want additional admission controls such as proof-of-work in the future.


## Data retained by the relay

The D1 schema currently includes:

- `network`
- `device`
- `transport_policy`
- `event`
- `pending_event`
- `device_pairing`
- `counter`
- `device_mobile_push_token` (reference FMNet worker migration)

Encrypted event rows are shared across recipients; each recipient has its own pending row containing the wrapped payload key. ACK removes pending delivery state, and the current server deletes an event once it has no remaining pending recipients.

## Operational security notes

Self-hosting gives you control over infrastructure but does not eliminate the need to understand SEPT's trust model.

Review at least:

- D1 and R2 retention/backups;
- Cloudflare account security;
- Worker logs and observability;
- rate limiting for bootstrap/pairing routes;
- metadata visibility at the relay;
- push-notification privacy if enabling the FMNet plugin;
- migration/rollback procedures.

See [Security](security.md) for protocol-level assumptions and known implementation caveats.
