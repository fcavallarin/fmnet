import { json } from '../lib/http.js';
import { getAuth } from '../lib/http.js';

export async function relayConnect(request, env) {
  const networkId = new URL(request.url).searchParams.get("networkId");
  const relay = env.RELAY.get(
    env.RELAY.idFromName(networkId)
  );
  return relay.fetch(request);
}

export async function relayGetTicket(request, env) {
  const auth = await getAuth(env, request);
  const relay = env.RELAY.get(
    env.RELAY.idFromName(auth.networkId)
  );

  return json({
    ok: true,
    ticket: await relay.storeNewTicket(auth.deviceId)
  });

}