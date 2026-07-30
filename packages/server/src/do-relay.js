import { randomBytes } from "@sept/crypto";
import { deserializeBin, makeId, serializeBin, now, isExpired, serializeEvent } from '@sept/core';
import { DurableObject } from "cloudflare:workers";

export class DORelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.connections = new Map();
    this.tickets = new Map();
  }

  storeNewTicket(deviceId){
    const ticket = serializeBin(randomBytes(32))
    this.tickets.set(ticket, {
      deviceId,
      createdAt: now(),
    })
    return ticket;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== "/ws") {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const deviceId = url.searchParams.get("deviceId");

    if (!deviceId) {
      return new Response("Missing deviceId", { status: 400 });
    }

    const ticket = url.searchParams.get("ticket");
    if (!ticket) {
      return new Response("Missing ticket in request", { status: 400 });
    }
    const storedTicket = this.tickets.get(ticket);
    this.tickets.delete(ticket)
    if (storedTicket?.deviceId !== deviceId) {
      return new Response("Missing ticket", { status: 400 });
    }
  
    if(isExpired(storedTicket.createdAt, 30)){
      return new Response("Ticket expired", { status: 400 });
    }
  
    const [client, server] = new WebSocketPair();

    server.accept();

    this.connections.set(deviceId, server);

    console.log(`[${this.ctx.id}] connected ${deviceId}`);

    server.addEventListener("close", () => {
      this.connections.delete(deviceId);
      console.log(`[${this.ctx.id}] disconnected ${deviceId}`);
    });

    server.addEventListener("error", () => {
      this.connections.delete(deviceId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  push(deviceId, payload) {
    const ws = this.connections.get(deviceId);

    if (!ws) {
      return false;
    }

    try {
      ws.send(
        typeof payload === "string"
          ? payload
          : JSON.stringify(payload)
      );

      return true;
    } catch (e){
      this.connections.delete(deviceId);
      console.error(`WS send error: ${e}`)
      return false;
    }
  }
}