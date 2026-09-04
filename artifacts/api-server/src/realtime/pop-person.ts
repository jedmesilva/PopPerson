import type { WebSocketServer, WebSocket } from "ws";
import type { PopPersonState } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type {
  PopPersonHitEvent,
  PopPersonResolvedEvent,
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
    | "action:started"
    | "action:hit"
    | "action:resolved"
    | "action:cancelled"
    | "clock:pong";
  state?: PopPersonState;
  action?: Awaited<ReturnType<typeof getPopPersonAction>>;
  actionId?: string;
  event?: PopPersonResolvedEvent;
  hit?: PopPersonHitEvent;
  serverTime?: number;
  clientTime?: number;
  stateVersion?: number;
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
  if (notification.type === "action:started") {
    const action = await getPopPersonAction(
      notification.roomId,
      notification.actionId,
    );
    if (!action || action.status !== "running") return;
    broadcast(webSocketServer, {
      type: "action:started",
      action,
      serverTime,
      stateVersion: notification.stateVersion,
    });
    logger.info(
      {
        actionId: action.id,
        state: action.status,
        serverTime,
        executeAt: action.executeAt,
        completesAt: action.completesAt,
        stateVersion: notification.stateVersion,
      },
      `PopPerson ${notification.type} published`,
    );
    return;
  }

  if (notification.type === "action:resolved") {
    const action = await getPopPersonAction(
      notification.roomId,
      notification.actionId,
    );
    if (!action) return;
    broadcast(webSocketServer, {
      type: "action:resolved",
      action,
      event: notification.event,
      serverTime,
      stateVersion: notification.event.stateVersion,
    });
    logger.info(
      {
        actionId: action.id,
        state: action.status,
        hitCount: notification.event.hitCount,
        serverTime,
        executeAt: action.executeAt,
        completesAt: action.completesAt,
        stateVersion: notification.event.stateVersion,
      },
      `PopPerson ${notification.type} published`,
    );
    return;
  }

  if (notification.type === "action:hit") {
    broadcast(webSocketServer, {
      type: "action:hit",
      actionId: notification.actionId,
      hit: notification.event,
      serverTime,
      stateVersion: notification.event.stateVersion,
    });
    logger.info(
      {
        actionId: notification.actionId,
        hitIndex: notification.event.hitIndex,
        targetName: notification.event.targetName,
        stateVersion: notification.event.stateVersion,
        serverTime,
      },
      `PopPerson ${notification.type} published`,
    );
    return;
  }

  if (notification.type === "state:changed") {
    broadcast(webSocketServer, {
      type: "snapshot",
      state: await getPopPersonState(),
      serverTime,
      stateVersion: notification.stateVersion,
    });
    logger.info(
      { roomId: notification.roomId, stateVersion: notification.stateVersion, serverTime },
      "PopPerson player state published",
    );
    return;
  }

  if (notification.type !== "action:cancelled") {
    logger.warn(
      { notificationType: notification.type },
      "Ignoring deprecated PopPerson realtime notification",
    );
    return;
  }
  broadcast(webSocketServer, {
    type: "action:cancelled",
    actionId: notification.actionId,
    serverTime,
    stateVersion: notification.stateVersion,
  });
  logger.info(
    {
      actionId: notification.actionId,
      type: notification.type,
      serverTime,
      stateVersion: notification.stateVersion,
    },
    `PopPerson ${notification.type} published`,
  );
}

export async function registerPopPersonRealtime(
  webSocketServer: WebSocketServer,
): Promise<void> {
  const listener = await pool.connect();
  // PostgreSQL delivers notifications in commit order, but handling every
  // notification in a detached promise can reorder messages at the browser.
  // Keep one delivery chain so each resolved action is broadcast as one
  // complete visual event.
  let notificationChain = Promise.resolve();
  listener.on("notification", (message) => {
    if (message.channel !== POP_PERSON_REALTIME_CHANNEL || !message.payload) return;
    try {
      const notification = JSON.parse(
        message.payload,
      ) as PopPersonRealtimeNotification;
      notificationChain = notificationChain
        .then(() => handleNotification(webSocketServer, notification))
        .catch((error) => {
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