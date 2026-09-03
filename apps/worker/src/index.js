import { createSeptServer, httpError, readJson, getAuth, jsonResponse } from '@sept/server'
export { DORelay } from '@sept/server'
import { now, isExpired, D1Adapter } from '@sept/core';




async function registerPushToken(request, env, params) {

  const body = await readJson(request);
  const auth = await getAuth(env, request, body);
  const db = new D1Adapter(() => env.DB)
  await db.write(
    `INSERT INTO device_mobile_push_token
    (device_id, push_token, created_at) values (?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET
      push_token = excluded.push_token
    `,
    [auth.deviceId, body.token, now()]
  )

  return jsonResponse({ ok: true })

}

async function sendPushNotification(env, deviceId) {
  console.log(deviceId)
  const db = new D1Adapter(() => env.DB)
  const token = await db.readOne(
    `SELECT push_token from device_mobile_push_token where device_id=?`,
    [deviceId]
  )

  if (!token || !token.pushToken) {
    return
  }
  console.log(token)
  await fetch(
    'https://exp.host/--/api/v2/push/send',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token.pushToken,

        title: 'FMNet',
        body: 'Nuovo messaggio',

        sound: 'default',

        data: {
          type: 'message'
        },
      }),
    },
  );

}

export default createSeptServer(
  [
    {
      routes: [
        { method: 'POST', path: '/register-push-token', handler: registerPushToken },
      ],
      events: {
        "event.received": async ({ env, eventData }) => {
          await sendPushNotification(env, eventData.deviceId)
        }
      }
    }
  ],
  {
    maxNetworks: 10
  }
)

