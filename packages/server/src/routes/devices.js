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

// @TODO deprecated
export async function listDevices(request, env, params) {
  const auth = await getAuth(env, request, undefined);

  const db = new D1Adapter(() => env.DB)
  const rows = await db.read(
    `SELECT id, network_id, sign_public_key, revoked_at, created_at
     FROM device
     WHERE network_id = ?
     ORDER BY created_at ASC`
    , [auth.networkId]);
  // console.log(rows)
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
    (device_id, network_id, sign_public_key, pin, sender_crypt_public_key, encrypted_payload, created_at)
    values (?, ? ,?, ?, ?, ?, ?)
    `
    , [
      body.id,
      body.networkId,
      body.signPublicKey,
      body.pin,
      body.senderPublicCryptKey,
      body.encryptedPayload,
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
     AND pin = ?`
    , [
      params.id,
      params.pin
    ]
  );

  try {
    await db.write(`DELETE from device_pairing WHERE id = ?`, [pairingData.id])
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
    ,[isAdmin ? 1 : 0, deviceId, auth.networkId]
  );

  return json({ ok: true });
}

