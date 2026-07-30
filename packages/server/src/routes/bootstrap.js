import { httpError, json, readJson } from '../lib/http.js';
import { D1Adapter, now } from '@sept/core';

export async function bootstrap(request, env) {

  const body = await readJson(request);
  const networkId = body.networkId
  const db = new D1Adapter(() => env.DB)
  const t = now();

  await db.write(
    `INSERT INTO network (id, created_at)
       VALUES (?, ?)`,
    [networkId, t])
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
