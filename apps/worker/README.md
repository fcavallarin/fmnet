# FMNet Worker MVP

Cloudflare Worker backend for FMNet.

## Bindings

- `DB`: Cloudflare D1 database.
- `MAILBOX`: Cloudflare R2 bucket for encrypted message/event blobs.
- `BOOTSTRAP_SECRET`: Worker secret used only for first-family bootstrap.

Set secret:

```bash
npx wrangler secret put BOOTSTRAP_SECRET
```

Apply migrations:

```bash
npm run db:migrate:remote
```

Run locally:

```bash
npm run dev
```

Deploy:

```bash
npm run deploy
```

## Routes

### GET `/health`

Health check.

### POST `/bootstrap`

Headers:

```text
X-Bootstrap-Secret: <secret>
```

Body:

```json
{
  "familyId": "family_1234567890123456",
  "deviceId": "device_1234567890123456",
  "publicKey": "mock-public-key",
  "name": "Filippo",
  "role": "parent"
}
```

Creates the family and first parent device.

### POST `/devices`

MVP route for adding devices.

Headers:

```text
X-Admin-Device-Id: <existing-parent-device-id>
```

Body:

```json
{
  "familyId": "family_1234567890123456",
  "deviceId": "device_child_1234567890",
  "publicKey": "mock-public-key-child",
  "role": "child",
  "name": "Guglielmo"
}
```

Real signed invites will replace this later.

### GET `/families/:familyId/devices`

Lists registered devices in a family.

### POST `/messages`

Headers:

```text
X-Device-Id: <sender-device-id>
```

Body:

```json
{
  "familyId": "family_1234567890123456",
  "messageId": "msg_1234567890123456",
  "recipients": ["device_child_1234567890", "device_1234567890123456"],
  "blob": "base64-encoded-encrypted-event"
}
```

Stores blob in R2 and creates D1 pending rows per recipient.

### GET `/sync/pull?deviceId=<deviceId>&limit=50`

Returns pending messages for a device, with base64 blobs.

### POST `/sync/ack`

Body:

```json
{
  "deviceId": "device_child_1234567890",
  "messageIds": ["msg_1234567890123456"]
}
```

Marks pending messages delivered for that device.

## Notes

This is intentionally an MVP backend:

- no real signature verification yet;
- no proof-of-work yet;
- no GC yet;
- messages are opaque encrypted blobs from the Worker's perspective;
- D1 is only an operational index, not the source of trust.
