import { getAuth, httpError, json, readJson } from '../lib/http.js';
import { deserializeBin, serializeEvent } from '@sept/core';
import { verifyString } from '@sept/crypto';
import { D1Adapter, now } from '@sept/core';


export async function createEvent(request, env, params, ctx) {

  const body = await readJson(request);
  const auth = await getAuth(env, request, body);
  const db = new D1Adapter(() => env.DB)
  const networkId = auth.networkId
  const device = await db.readOne(
    `SELECT * FROM device WHERE id = ? and network_id = ? and revoked_at is null`,
    [auth.deviceId, networkId])

  const {
    recipients, senderDeviceId, encryptedPayload, timestamp, eventId, signature, relaySignature
  } = body;
  if (device?.id !== senderDeviceId) {
    throw httpError(404, 'unauthorized');
  }
  const serialized = serializeEvent(networkId, eventId, recipients, senderDeviceId, encryptedPayload, timestamp);
  const verified = await verifyString(
    deserializeBin(device.signPublicKey),
    deserializeBin(relaySignature),
    serialized
  )
  if (!verified) {
    throw httpError(404, 'unauthorized: signature verification failed');
  }

  const { results } = await db.write(
    `UPDATE counter
    SET value = value + 1
    WHERE name = 'event_sequence'
    RETURNING value`,
    []);

  const sequence = results[0].value

  await db.write(
    `INSERT INTO event (id, network_id, sender_device_id, encrypted_payload, created_at, expires_at, sequence, signature, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    , [eventId, networkId, senderDeviceId, encryptedPayload, now(), 0, sequence, signature, timestamp])


  const relay = env.RELAY.get(env.RELAY.idFromName(networkId));

  for (const recipient of recipients) {
    await db.write(
      `INSERT OR IGNORE INTO pending_event (device_id, event_id, encrypted_payload_key, created_at)
       VALUES (?, ?, ?, ?)`,
      [recipient.deviceId, eventId, recipient.encryptedPayloadKey, now()]);

    const recipientEvent = {
      eventId, networkId, senderDeviceId, encryptedPayload, sequence, signature, timestamp,
      encryptedPayloadKey: recipient.encryptedPayloadKey
    }
    await relay.push(recipient.deviceId, recipientEvent);
    await ctx.eventBus.dispatch("event.received", {
      env,
      eventData: {
        ...recipientEvent,
        deviceId: recipient.deviceId
      }
    });
  }

  return json({
    ok: verified, networkId, sequence
  });
}

export async function listEvents(request, env) {
  const auth = await getAuth(env, request);
  const db = new D1Adapter(() => env.DB)
  const rows = await db.read(
    `SELECT event_id, encrypted_payload_key, sender_device_id, encrypted_payload, sequence, signature, timestamp
       FROM pending_event p
       INNER JOIN event e on e.id = p.event_id
       WHERE device_id = ?
       AND e.network_id = ?
       ORDER BY e.sequence ASC`
    , [auth.deviceId, auth.networkId]);

  return json({ ok: true, events: rows || [] });
};


export async function ackEvents(request, env) {
  const body = await readJson(request);
  const auth = await getAuth(env, request, body);
  const db = new D1Adapter(() => env.DB)
  for (const peId of body.pendingEvents) {
    // @TODO: use whre event_id in ... 
    await db.write(
      `DELETE 
       FROM pending_event 
       WHERE event_id = ?
       AND device_id = ?`
      , [peId, auth.deviceId]);
    await db.write(`
      DELETE FROM event AS e
      WHERE NOT EXISTS (
        SELECT 1
        FROM pending_event AS p
        WHERE p.event_id = e.id
      ) AND e.id = ?
    `, [peId])
  }

  return json({ ok: true });
};
