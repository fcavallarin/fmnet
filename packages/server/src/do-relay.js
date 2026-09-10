import { randomBytes } from "@sept/crypto";
import {
  deserializeBin,
  makeId,
  serializeBin,
  now,
  isExpired,
  serializeEvent
} from "@sept/core";
import { DurableObject } from "cloudflare:workers";

export class DORelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async storeNewTicket(deviceId) {
    const ticket = serializeBin(randomBytes(32));

    await this.ctx.storage.put(`ticket:${ticket}`, {
      deviceId,
      createdAt: now(),
    });

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

    const ticketKey = `ticket:${ticket}`;
    const storedTicket = await this.ctx.storage.get(ticketKey);

    // Ticket is single-use regardless of whether validation succeeds.
    await this.ctx.storage.delete(ticketKey);

    if (storedTicket?.deviceId !== deviceId) {
      return new Response("Missing ticket", { status: 400 });
    }

    if (isExpired(storedTicket.createdAt, 30)) {
      return new Response("Ticket expired", { status: 400 });
    }

    const [client, server] = new WebSocketPair();

    // Close an existing connection for the same device.
    for (const ws of this.ctx.getWebSockets(deviceId)) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000, "Replaced by new connection");
      }
    }

    this.ctx.acceptWebSocket(server, [deviceId]);

    // Optional, but useful for logging close/error events.
    // This survives hibernation with the WebSocket.
    server.serializeAttachment({ deviceId });

    console.log(`[${this.ctx.id}] connected ${deviceId}`);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  push(deviceId, payload) {
    const ws = this.ctx
      .getWebSockets(deviceId)
      .find(ws => ws.readyState === WebSocket.OPEN);

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
    } catch (e) {
      console.error(`WS send error: ${e}`);
      return false;
    }
  }

  webSocketMessage(ws, message) {
    // Keep the handler because Hibernation WebSocket events are delivered here.
  }

  webSocketClose(ws, code, reason, wasClean) {
    const { deviceId } = ws.deserializeAttachment() ?? {};

    console.log(
      `[${this.ctx.id}] disconnected ${deviceId ?? "unknown"} ` +
      `code=${code} clean=${wasClean}`
    );

    // New Cloudflare runtimes normally already closed it for us.
    if (ws.readyState === WebSocket.CLOSED) {
      return;
    }

    // Older/local runtimes may still require us to complete the handshake.
    try {
      ws.close(code, reason);
    } catch (e) {
      console.warn(
        `Could not close WS with code=${code}, falling back to close(): ${e}`
      );

      try {
        ws.close();
      } catch (e) {
        console.error(`WS close fallback failed: ${e}`);
      }
    }
  }

  webSocketError(ws, error) {
    const { deviceId } = ws.deserializeAttachment() ?? {};

    console.error(
      `[${this.ctx.id}] websocket error ${deviceId ?? "unknown"}:`,
      error
    );
  }
}