import { json, route } from './lib/http.js';
import { bootstrap } from './routes/bootstrap.js';
import { addDevice, createPairing, getPairing, listDevices, setAdmin } from './routes/devices.js';
import { createEvent, listEvents, ackEvents } from './routes/event.js';
import { relayConnect, relayGetTicket } from './routes/relay.js';
import { DORelay } from "./do-relay.js";
import {EventBus} from '@sept/core'

const jsonResponse = json
export { DORelay, jsonResponse };

class SeptServerPlugin {

}

// class Route {
//   constructor(method, path, handler){
//     this.
//   }
// }

const eventBus = new EventBus([
  "event.received"
]);

const ROUTES = [
  { method: 'POST', path: '/bootstrap', handler: bootstrap },
  { method: 'POST', path: '/devices', handler: addDevice },
  { method: 'GET', path: '/devices', handler: listDevices },
  { method: 'POST', path: '/event', handler: createEvent },
  { method: 'GET', path: '/events', handler: listEvents },
  { method: 'PATCH', path: '/events', handler: ackEvents },
  { method: 'POST', path: '/devices/create-pairing', handler: createPairing },
  { method: 'GET', path: '/devices/pairing/:id/:pin', handler: getPairing },

  { method: 'GET', path: '/ws', handler: relayConnect },
  { method: 'GET', path: '/get-relay-ticket', handler: relayGetTicket },

  { method: 'PATCH', path: '/devices/set-admin', handler: setAdmin },
];

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    // 'access-control-allow-headers': 'content-type,x-bootstrap-secret,x-device-id,x-admin-device-id',
    'access-control-allow-headers': 'content-type',
  };
}

async function dispatch(request, env, ctx) {

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);

  for (const r of ROUTES) {
    const params = route(request.method, url.pathname, r);
    if (params) {
      // console.log(r.handler)
      const response = await r.handler(request, env, params, {workerCtx: ctx, eventBus});
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
      return new Response(response.body, { status: response.status, webSocket: response.webSocket, headers });
    }
  }

  return json({ error: 'not_found' }, 404, corsHeaders());
}

export function createSeptServer(plugins) {
  for(const p of plugins){
    if(p.routes){
      ROUTES.push(...p.routes);
    }
    for(const ev in p.events || []){
      eventBus.on(ev, p.events[ev])
    }
  }

  return {
    fetch: async (request, env, ctx) => {
      try {
        return await dispatch(request, env, ctx);
      } catch (err) {
        const status = err.status || 500;
        const code = err.code || (status === 500 ? 'internal_error' : 'error');
        return json({ error: code, message: err.message }, status, corsHeaders());
      }
    }
  }
}
