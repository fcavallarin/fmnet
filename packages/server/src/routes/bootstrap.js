import { httpError, json, readJson } from '../lib/http.js';
import { D1Adapter, now } from '@sept/core';

export async function bootstrap(request, env, params, ctx) {

  const body = await readJson(request);
  const networkId = body.networkId
  const db = new D1Adapter(() => env.DB)
  const t = now();

  const maxNetworks = ctx.options.maxNetworks

  const result = await db.write(
    `INSERT INTO network (id, created_at)
   SELECT ?, ?
   WHERE (SELECT COUNT(*) FROM network) < ?`,
    [networkId, t, maxNetworks]
  )

  if (result.meta.changes !== 1) {
    throw httpError(403, "Network limit reached")
  }

  await db.write(
    `INSERT INTO device (id, network_id, sign_public_key, created_at, is_admin)
       VALUES (?, ?, ?, ?, 1)`,
    [body.rootDeviceId, networkId, body.rootDeviceSignPublicKey, t])
  await db.write(
    `INSERT INTO transport_policy (network_id, device_id, permissions, created_at)
       VALUES (?, ?, ?, ?)`,
    [networkId, body.rootDeviceId, JSON.stringify(["admin"]), t])

  return json({ ok: true, networkId });
}
