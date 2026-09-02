import { deserializeBin, SeptRequest, D1Adapter, now } from "@sept/core";


export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export function text(data, status = 200, extraHeaders = {}) {
  return new Response(data, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export async function readJson(request, maxBytes = 256 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw httpError(413, 'body_too_large');

  let body;
  try {
    body = await request.json();
  } catch {
    throw httpError(400, 'invalid_json');
  }

  return body;
}

export function httpError(status, code, details = undefined) {
  const err = new Error(code);
  err.status = status;
  err.code = code;
  err.details = details;
  return err;
}

export function route(method, pathname, pattern) {
  if (method !== pattern.method) return null;
  const a = pathname.split('/').filter(Boolean);
  const b = pattern.path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;

  const params = {};
  for (let i = 0; i < b.length; i++) {
    if (b[i].startsWith(':')) {
      params[b[i].slice(1)] = decodeURIComponent(a[i]);
      continue;
    }
    if (a[i] !== b[i]) return null;
  }
  return params;
}

export async function getAuth(env, request, body) {
  const purl = new URL(request.url)
  const req = {
    method: request.method,
    path: purl.pathname,
    query: Object.fromEntries(purl.searchParams),
    headers: Object.fromEntries(request.headers.entries()),
    body
  }
  const deviceId = SeptRequest.getDeviceId(req)
  if (!deviceId) {
    throw httpError(400, "Missing SEPT headers")
  }
  const db = new D1Adapter(() => env.DB)
  const device = await db.readOne(`SELECT * from device where id = ?`, [deviceId])
  const nonceSeen = async (deviceId, nonce) => {
    const ts = now();
    try {
      await db.write(
        `INSERT INTO seen_nonce (device_id, nonce, created_at, expires_at)
         VALUES (?, ?, ?, ?)`,
        [deviceId, nonce, ts, ts + 300]);
      return false; // insert succeeded -> nonce is new
    } catch (e) {
      // PK violation on (device_id, nonce) -> already used -> replay
      return true;
    }
  };


  if (!device || ! await SeptRequest.verify(req, body, deserializeBin(device.signPublicKey), { nonceSeen })) {
    throw httpError(400, 'invalid_signature');
  }

  return {
    deviceId: device.id,
    networkId: device.networkId,
    permissions: [], //transportPolicy.permissions
    isAdmin: device.isAdmin === 1,
    isNetworkAdmin: nid => device.isAdmin === 1 && device.networkId === nid
  }
}

export async function cleanupExpiredNonces(env) {
  const db = new D1Adapter(() => env.DB)
  const result = await db.write(
    `DELETE FROM seen_nonce WHERE expires_at < ?`,
    [now()]
  )
  return result?.meta?.changes ?? 0
}