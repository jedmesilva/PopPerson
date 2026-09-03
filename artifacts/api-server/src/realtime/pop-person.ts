import type { WebSocketServer, WebSocket } from "ws";
import type { PopPersonState } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type {
  PopPersonResolvedEvent,
  PopPersonRealtimeNotification,
} from "../lib/pop-person-store";
import {
  getPopPersonAction,
  getPopPersonRealtimeEventsSince,
  getPopPersonState,
  POP_PERSON_REALTIME_CHANNEL,
} from "../lib/pop-person";
import { logger } from "../lib/logger";
import {
  incrementMetric,
  observeMetric,
  setMetric,
} from "../lib/runtime-metrics";

type PopPersonRealtimeMessage = {
  type:
    | "snapshot"
    | "effects:batch"
    | "action:resolved"
    | "action:cancelled"
    | "clock:pong";
  state?: PopPersonState;
  action?: Awaited<ReturnType<typeof getPopPersonAction>>;
  actionId?: string;
  event?: PopPersonResolvedEvent;
  actions?: Array<{
    action: Awaited<ReturnType<typeof getPopPersonAction>>;
    event: PopPersonResolvedEvent;
  }>;
  serverTime?: number;
  clientTime?: number;
  stateVersion?: number;
};

type ResolvedDelivery = {
  action: NonNullable<Awaited<ReturnType<typeof getPopPersonAction>>>;
  event: PopPersonResolvedEvent;
};

function sendMessage(socket: WebSocket, message: PopPersonRealtimeMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  // A slow browser must not retain an unbounded queue of visual effects.
  // It will receive a fresh snapshot after reconnecting instead of replaying
  // delayed impacts.
  if (socket.bufferedAmount > 1_000_000) {
    incrementMetric("realtime.slow_connections");
    socket.close(1013, "Realtime client is too slow");
    return;
  }
  const serialized = JSON.stringify(message);
  socket.send(serialized);
  incrementMetric("realtime.messages_sent");
  incrementMetric("realtime.bytes_sent", Buffer.byteLength(serialized));
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

async function handleNotificationBatch(
  webSocketServer: WebSocketServer,
  notifications: PopPersonRealtimeNotification[],
): Promise<void> {
  const resolvedNotifications = notifications.filter(
    (notification): notification is Extract<
      PopPersonRealtimeNotification,
      { type: "action:resolved" }
    > => notification.type === "action:resolved",
  );
  if (resolvedNotifications.length > 0) {
    const actions = (
      await Promise.all(
        resolvedNotifications.map(async (notification) => {
          const action = await getPopPersonAction(
            notification.roomId,
            notification.actionId,
          );
          if (!action) return null;
          return { action, event: notification.event };
        }),
      )
    ).filter(
      (delivery): delivery is ResolvedDelivery => Boolean(delivery?.action),
    );

    if (actions.length > 0) {
      incrementMetric("realtime.effect_batches");
      incrementMetric("realtime.effects_delivered", actions.length);
      const stateVersion = Math.max(
        ...actions.map(({ event }) => Number(event.stateVersion) || 0),
      );
      webSocketServer.clients.forEach((socket) =>
        sendMessage(socket, {
          type: "effects:batch",
          actions,
          serverTime: Date.now(),
          stateVersion,
        }),
      );
      actions.forEach(({ action, event }) => {
        logger.info(
          {
            actionId: action?.id,
            state: action?.status,
            hitCount: event.hitCount,
            serverTime: Date.now(),
            executeAt: action?.executeAt,
            completesAt: action?.completesAt,
            stateVersion: event.stateVersion,
          },
          "PopPerson action published in effects batch",
        );
      });
    }
  }

  const cancelledNotifications = notifications.filter(
    (notification): notification is Extract<
      PopPersonRealtimeNotification,
      { type: "action:cancelled" }
    > => notification.type === "action:cancelled",
  );
  cancelledNotifications.forEach((notification) => {
    broadcast(webSocketServer, {
      type: "action:cancelled",
      actionId: notification.actionId,
      serverTime: Date.now(),
      stateVersion: notification.stateVersion,
    });
  });

  const stateChanges = notifications.filter(
    (notification): notification is Extract<
      PopPersonRealtimeNotification,
      { type: "state:changed" }
    > => notification.type === "state:changed",
  );
  if (stateChanges.length > 0) {
    const state = await getPopPersonState();
    broadcast(webSocketServer, {
      type: "snapshot",
      state,
      serverTime: Date.now(),
      stateVersion: Math.max(
        Number(state.stateVersion) || 0,
        ...stateChanges.map((notification) => notification.stateVersion),
      ),
    });
  }
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
  let pendingNotifications: PopPersonRealtimeNotification[] = [];
  let batchTimer: NodeJS.Timeout | null = null;

  const scheduleNotificationBatch = (): void => {
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      batchTimer = null;
      const batch = pendingNotifications;
      pendingNotifications = [];
      if (batch.length === 0) return;
      notificationChain = notificationChain
        .then(() => handleNotificationBatch(webSocketServer, batch))
        .catch((error) => {
          logger.error({ err: error }, "Failed to deliver PopPerson realtime batch");
        });
    }, 16);
    batchTimer.unref();
  };

  listener.on("notification", (message) => {
    if (message.channel !== POP_PERSON_REALTIME_CHANNEL || !message.payload) return;
    try {
      const notification = JSON.parse(
        message.payload,
      ) as PopPersonRealtimeNotification;
      pendingNotifications.push(notification);
      scheduleNotificationBatch();
    } catch (error) {
      logger.warn({ err: error }, "Ignoring malformed PopPerson realtime event");
    }
  });
  await listener.query(`LISTEN ${POP_PERSON_REALTIME_CHANNEL}`);

  webSocketServer.on("connection", async (socket) => {
    incrementMetric("realtime.connections_opened");
    setMetric("realtime.connections_active", webSocketServer.clients.size);
    const connectedAt = Date.now();
    socket.once("close", () => {
      incrementMetric("realtime.connections_closed");
      observeMetric("realtime.connection_ms", Date.now() - connectedAt);
      setMetric("realtime.connections_active", webSocketServer.clients.size);
    });
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
        if (message?.type === "resume") {
          incrementMetric("realtime.replay_requests");
          const requestedVersion = Number(message.stateVersion);
          if (!Number.isFinite(requestedVersion) || requestedVersion < 0) return;
          void getPopPersonRealtimeEventsSince(requestedVersion).then(async (replay) => {
            if (replay.hasMore) {
              incrementMetric("realtime.replay_snapshots");
              sendMessage(socket, {
                type: "snapshot",
                state: await getPopPersonState(),
                serverTime: Date.now(),
              });
              return;
            }
            if (replay.events.length === 0) return;
            incrementMetric("realtime.replay_effect_batches");
            sendMessage(socket, {
              type: "effects:batch",
              actions: replay.events,
              serverTime: Date.now(),
              stateVersion: Math.max(
                ...replay.events.map(({ event }) => event.stateVersion),
              ),
            });
          }).catch((error) => {
            logger.warn({ err: error }, "Failed to replay PopPerson realtime events");
          });
          return;
        }
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