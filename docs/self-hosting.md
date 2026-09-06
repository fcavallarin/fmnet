# Self-hosting the SEPT relay

SEPT includes a generic Cloudflare deployment template for self-hosting `@sept/server`. The scaffolded deployment is intentionally separate from `apps/worker`, which is the reference/FMNet deployment and may contain application-specific integrations such as push notifications.

The generated server is created under `deployments/<name>` and remains part of the npm workspace, so local `@sept/*` packages are resolved directly from the monorepo.

## Requirements

- Node.js/npm
- a Cloudflare account
- Wrangler access to that account

The generated deployment includes Wrangler as a development dependency. `npm run create` checks Wrangler authentication and starts `wrangler login` when required.

## Quick start

From the repository root:

```bash
npm run scaffold:server -- my-sept
cd deployments/my-sept
```

The scaffold command:

1. copies the generic Cloudflare template;
2. configures the Worker, package and resource names from `my-sept`;
3. creates the `deployments/my-sept` workspace;
4. installs that workspace and its local `@sept/server` dependency.

The generated deployment contains:

```text
deployments/my-sept/
├── migrations/
│   └── 0001_initial.sql
├── scripts/
│   ├── create.js
│   └── utils.js
├── src/
│   └── index.js
├── package.json
└── wrangler.jsonc
```

### Create and deploy the server

Run:

```bash
npm run create
```

The current `create` script performs the remaining first-deployment steps:

1. verifies Wrangler authentication;
2. creates the D1 database using the deployment name;
3. adds the `DB` binding and D1 `database_id` to `wrangler.jsonc` via Wrangler's `--update-config` support;
4. applies the remote D1 migrations;
5. deploys the Worker.

There is no need to copy the D1 database ID manually.

Wrangler prints the deployed Worker URL, typically of the form:

```text
https://<worker>.<account-subdomain>.workers.dev
```

## Cloudflare resources

The generic scaffold currently expects:

| Binding | Resource | Purpose |
| --- | --- | --- |
| `DB` | D1 | networks, devices, pairings, encrypted events and pending delivery |
| `RELAY` | Durable Object | live WebSocket delivery per SEPT network |
| `MAILBOX` | R2 | configured server bucket; storage usage is evolving |

The Worker enables the `nodejs_compat` compatibility flag and exports `DORelay` from `@sept/server`.

### Durable Object configuration

The generated `wrangler.jsonc` binds:

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

and contains the initial SQLite Durable Object migration. Wrangler applies the DO class migration as part of deployment; you do not create a separate named Durable Object instance manually. Instances are derived by the server from the SEPT network ID.

## Subsequent deployments

After the resources have been created, deploy code changes with:

```bash
npm run deploy
```

If a new D1 migration is added to the generated deployment, apply remote migrations with:

```bash
npm run migrate
```

Then deploy as usual.

## Local development

Apply migrations to the local Wrangler D1 database:

```bash
npm run migrate:local
```

Then start the Worker locally:

```bash
npm run dev
```

The default local Wrangler origin is normally:

```text
http://localhost:8787
```

## Point clients at your relay

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

## Generic server composition

The generated server starts with a minimal SEPT composition:

```js
import { createSeptServer } from "@sept/server"

export { DORelay } from "@sept/server"

export default createSeptServer([], {
  maxNetworks: 1
})
```

This keeps the self-hosted relay independent from FMNet-specific Worker plugins.

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

The generated template uses `1`, which is appropriate for a typical single-network self-hosted deployment.

Once the configured number of networks exists, further `POST /bootstrap` requests are rejected. Shared or public relay operators can explicitly configure a higher value based on the intended deployment and available resources.

Because bootstrap is intentionally unauthenticated, `maxNetworks` also acts as a basic resource-exhaustion safeguard. Public permissionless deployments may still want additional admission controls in the future.

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

The reference `apps/worker` deployment demonstrates FMNet-specific behavior including:

- `POST /register-push-token`;
- an `event.received` hook that can trigger an Expo push notification for the recipient device.

Those features are application deployment concerns, not requirements for a generic SEPT relay. The scaffolded server starts without those plugins.

## D1 migrations and retained data

The generic scaffold currently starts with:

```text
migrations/0001_initial.sql
```

Its D1 schema includes the core SEPT relay tables:

- `network`
- `device`
- `transport_policy`
- `event`
- `pending_event`
- `device_pairing`
- `counter`
- `seen_nonce`

The FMNet reference Worker may add application-specific migrations such as mobile push-token storage; those are deliberately not part of the generic server scaffold.

Encrypted event rows are shared across recipients; each recipient has its own pending row containing the wrapped payload key. ACK removes pending delivery state, and the current server deletes an event once it has no remaining pending recipients.

## Operational security notes

Self-hosting gives you control over infrastructure but does not eliminate the need to understand SEPT's trust model.

Review at least:

- D1 and R2 retention/backups;
- Cloudflare account security;
- Worker logs and observability;
- rate limiting and admission control for bootstrap/pairing routes;
- metadata visibility at the relay;
- push-notification privacy if adding the FMNet plugin;
- migration/rollback procedures.

See [Security](security.md) for protocol-level assumptions and known implementation caveats.
