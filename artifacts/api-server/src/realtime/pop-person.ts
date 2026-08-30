import type { WebSocketServer, WebSocket } from "ws";
import type { PopPersonState } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type {
  PopPersonHitEvent,
  PopPersonRealtimeNotification,
} from "../lib/pop-person-store";
import {
  getPopPersonAction,
  getPopPersonState,
  POP_PERSON_REALTIME_CHANNEL,
} from "../lib/pop-person";
import { logger } from "../lib/logger";

type PopPersonRealtimeMessage = {
  type:
    | "snapshot"
    | "action:queued"
    | "action:started"
    | "action:completed"
    | "action:cancelled"
    | "hit"
    | "clock:pong";
  state?: PopPersonState;
  action?: Awaited<ReturnType<typeof getPopPersonAction>>;
  actionId?: string;
  event?: PopPersonHitEvent;
  serverTime?: number;
  clientTime?: number;
};

function sendMessage(socket: WebSocket, message: PopPersonRealtimeMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  // A slow browser must not retain an unbounded queue of visual effects.
  // It will receive a fresh snapshot after reconnecting instead of replaying
  // delayed impacts.
  if (socket.bufferedAmount > 1_000_000) {
    socket.close(1013, "Realtime client is too slow");
    return;
  }
  socket.send(JSON.stringify(message));
}

function broadcast(
  webSocketServer: WebSocketServer,
  message: PopPersonRealtimeMessage,
): void {
  webSocketServer.clients.forEach((socket) => sendMessage(socket, message));
}

async function handleNotification(
  webSocketServer: WebSocketServer,
  notification: PopPersonRealtimeNotification,
): Promise<void> {
  const serverTime = Date.now();
  if (notification.type === "action:queued" || notification.type === "action:started") {
    const action = await getPopPersonAction(
      notification.roomId,
      notification.actionId,
    );
    if (!action) return;
    broadcast(webSocketServer, {
      type: notification.type,
      action,
      serverTime,
    });
    return;
  }

  if (notification.type === "action:hit") {
    broadcast(webSocketServer, {
      type: "hit",
      event: notification.event,
      serverTime,
    });
    return;
  }

  broadcast(webSocketServer, {
    type: notification.type,
    actionId: notification.actionId,
    serverTime,
  });
}

export async function registerPopPersonRealtime(
  webSocketServer: WebSocketServer,
): Promise<void> {
  const listener = await pool.connect();
  listener.on("notification", (message) => {
    if (message.channel !== POP_PERSON_REALTIME_CHANNEL || !message.payload) return;
    try {
      const notification = JSON.parse(
        message.payload,
      ) as PopPersonRealtimeNotification;
      void handleNotification(webSocketServer, notification).catch((error) => {
        logger.error({ err: error }, "Failed to deliver PopPerson realtime event");
      });
    } catch (error) {
      logger.warn({ err: error }, "Ignoring malformed PopPerson realtime event");
    }
  });
  await listener.query(`LISTEN ${POP_PERSON_REALTIME_CHANNEL}`);

  webSocketServer.on("connection", async (socket) => {
    try {
      sendMessage(socket, {
        type: "snapshot",
        state: await getPopPersonState(),
        serverTime: Date.now(),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to send PopPerson realtime snapshot");
      socket.close(1011, "Realtime snapshot unavailable");
      return;
    }
    socket.on("message", (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        if (message?.type !== "clock:ping") return;
        sendMessage(socket, {
          type: "clock:pong",
          serverTime: Date.now(),
          clientTime: Number(message.clientTime) || undefined,
        });
      } catch {
        // Ignore malformed client messages. State delivery is unaffected.
      }
    });
  });
}