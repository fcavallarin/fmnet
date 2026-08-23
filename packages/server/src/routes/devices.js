import { httpError, json, readJson } from '../lib/http.js';
import { D1Adapter, now, isExpired } from '@sept/core';
import { getAuth } from '../lib/http.js';


// @TODO deprecated
export async function addDevice(request, env) {
  const body = await readJson(request);
  const {
    deviceId, networkId, signPublicKey
  } = body;
  const db = new D1Adapter(() => env.DB)

  await db.write(
    `INSERT INTO device (id, network_id, sign_public_key, created_at)
     VALUES (?, ?, ?, ?)`,
    [deviceId, networkId, signPublicKey, now()]);

  return json({ ok: true, networkId, deviceId });
}


export async function listDevices(request, env, params) {
  const auth = await getAuth(env, request, undefined);
  if (!auth.isAdmin) {
    throw httpError(404, "Unauthorized")
  }
  const db = new D1Adapter(() => env.DB)
  const rows = await db.read(
    `SELECT id, network_id, sign_public_key, revoked_at, created_at
     FROM device
     WHERE network_id = ?
     ORDER BY created_at ASC`
    , [auth.networkId]);

  return json({ ok: true, devices: rows || [] });
}


export async function createPairing(request, env, params) {
  const body = await readJson(request);
  const auth = await getAuth(env, request, body);

  if (!auth.isNetworkAdmin(body.networkId)) {
    throw httpError(404, "Unauthorized")
  }
  const db = new D1Adapter(() => env.DB)
  const rows = await db.write(
    `INSERT INTO device_pairing 
    (
      device_id,
      network_id,
      sign_public_key,
      pin,
      sender_crypt_public_key,
      encrypted_payload,
      encrypted_admin_payload,
      initiator_device_id,
      created_at
    )
    values (?, ? ,?, ?, ?, ?, ?, ?, ?)
    `
    , [
      body.id,
      body.networkId,
      body.signPublicKey,
      body.pin,
      body.senderPublicCryptKey,
      body.encryptedPayload,
      body.encryptedAdminPayload,
      auth.deviceId,
      now()
    ]);

  return json({ ok: true });
}

export async function getPairing(request, env, params) {
  const db = new D1Adapter(() => env.DB)
  const pairingData = await db.readOne(
    `SELECT *
     FROM device_pairing
     WHERE device_id = ?
     AND pin = ?
     AND redeemed_at IS NULL`
    , [
      params.id,
      params.pin
    ]
  );

  try {
    await db.write(`UPDATE device_pairing set redeemed_at = ? WHERE id = ?`, [now(), pairingData.id])
  } catch { }

  if (!pairingData) {
    throw httpError(400, "Pairing failed")
  }

  if (isExpired(pairingData.createdAt, 60)) {
    throw httpError(400, "Pairing expired")
  }

  await db.write(
    `INSERT INTO device (id, network_id, sign_public_key, created_at)
     VALUES (?, ?, ?, ?)`,
    [
      pairingData.deviceId,
      pairingData.networkId,
      pairingData.signPublicKey,
      now()
    ]
  )

  return json({
    ok: true,
    pairingData: {
      senderCryptPublicKey: pairingData.senderCryptPublicKey,
      encryptedPayload: pairingData.encryptedPayload
    }
  });
}

export async function getPairedDevices(request, env, params) {
  const auth = await getAuth(env, request);
  if (!auth.isAdmin) {
    throw httpError(404, "Unauthorized")
  }
  const db = new D1Adapter(() => env.DB)
  const pairingData = await db.read(
    `SELECT *
     FROM device_pairing
     WHERE network_id = ?
     AND redeemed_at IS NOT NULL
     AND initiator_device_id = ?`
    , [auth.networkId, auth.deviceId]
  )

  const devices = pairingData.map(d => ({
    encryptedPayload: d.encryptedAdminPayload
  }));

  return json({ ok: true, devices });
}

export async function deletePairedDevice(request, env, params) {
  const auth = await getAuth(env, request);
  if (!auth.isAdmin) {
    throw httpError(404, "Unauthorized")
  }
  const db = new D1Adapter(() => env.DB)
  await db.write(`
    DELETE from device_pairing where network_id = ?
    AND device_id = ?
    AND initiator_device_id = ?
    `, [auth.networkId, params.deviceId, auth.deviceId])
  return json({ ok: true });
}

export async function setAdmin(request, env, params) {
  const body = await readJson(request);
  const auth = await getAuth(env, request, body);
  if (!auth.isAdmin) {
    throw httpError(404, "Unauthorized")
  }
  const { isAdmin, deviceId } = body

  const db = new D1Adapter(() => env.DB)
  await db.write(
    `UPDATE device set is_admin = ? where id = ? and network_id = ? and revoked_at is null`
    , [isAdmin ? 1 : 0, deviceId, auth.networkId]
  );

  return json({ ok: true });
}

export async function invalidate(request, env, params) {
  const body = await readJson(request);
  const auth = await getAuth(env, request, body);
  if (!auth.isAdmin) {
    throw httpError(404, "Unauthorized")
  }
  const { deviceId } = body

  const db = new D1Adapter(() => env.DB)
  await db.write(
    `UPDATE device set revoked_at = ? where id = ? and network_id = ?`
    , [now(), deviceId, auth.networkId]
  );

  return json({ ok: true });
}