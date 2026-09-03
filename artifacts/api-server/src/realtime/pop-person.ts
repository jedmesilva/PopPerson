import type { WebSocketServer, WebSocket } from "ws";
import type { PopPersonState } from "@workspace/api-zod";
import { pool } from "@workspace/db";
import type {
  PopPersonResolvedEvent,
  PopPersonRealtimeNotification,
  PopPersonRealtimeOutboxEvent,
} from "../lib/pop-person-store";
import {
  getPopPersonAction,
  getPopPersonRealtimeOutboxSince,
  getPopPersonRealtimeSequence,
  getPopPersonState,
  markPopPersonRealtimeOutboxPublished,
  cleanupPopPersonRealtimeOutbox,
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
    | "action:queued"
    | "action:resolved"
    | "action:cancelled"
    | "clock:pong";
  sequence?: number;
  sequenceStart?: number;
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
  sequence: number;
  action: NonNullable<Awaited<ReturnType<typeof getPopPersonAction>>>;
  event: PopPersonResolvedEvent;
};

function sendMessage(socket: WebSocket, message: PopPersonRealtimeMessage): void {
  if (socket.readyState !== socket.OPEN) return;
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

async function hydrateResolved(
  row: PopPersonRealtimeOutboxEvent,
): Promise<ResolvedDelivery | null> {
  const notification = row.payload as unknown as Extract<
    PopPersonRealtimeNotification,
    { type: "action:resolved" }
  >;
  const action = await getPopPersonAction(notification.roomId, notification.actionId);
  if (!action) return null;
  return { sequence: row.sequence, action, event: notification.event };
}

async function deliverOutboxRows(
  webSocketServer: WebSocketServer,
  rows: PopPersonRealtimeOutboxEvent[],
): Promise<void> {
  let resolved: ResolvedDelivery[] = [];
  const flushResolved = (): void => {
    if (resolved.length === 0) return;
    const actions = resolved;
    resolved = [];
    const stateVersion = Math.max(
      ...actions.map(({ event }) => Number(event.stateVersion) || 0),
    );
    broadcast(webSocketServer, {
      type: "effects:batch",
      actions: actions.map(({ action, event }) => ({ action, event })),
      serverTime: Date.now(),
      sequence: actions[actions.length - 1].sequence,
      sequenceStart: actions[0].sequence,
      stateVersion,
    });
    incrementMetric("realtime.effect_batches");
    incrementMetric("realtime.effects_delivered", actions.length);
  };

  for (const row of rows) {
    if (row.topic === "action:resolved") {
      const delivery = await hydrateResolved(row);
      if (delivery) resolved.push(delivery);
      continue;
    }

    flushResolved();
    const payload = row.payload as unknown as PopPersonRealtimeNotification;
    if (payload.type === "action:queued") {
      const action = await getPopPersonAction(payload.roomId, payload.actionId);
      if (action) {
        broadcast(webSocketServer, {
          type: "action:queued",
          action,
          actionId: payload.actionId,
          stateVersion: payload.stateVersion,
          sequence: row.sequence,
          serverTime: Date.now(),
        });
      }
      continue;
    }
    if (payload.type === "action:cancelled") {
      broadcast(webSocketServer, {
        type: "action:cancelled",
        actionId: payload.actionId,
        stateVersion: payload.stateVersion,
        sequence: row.sequence,
        serverTime: Date.now(),
      });
      continue;
    }
    if (payload.type === "state:changed") {
      broadcast(webSocketServer, {
        type: "snapshot",
        state: await getPopPersonState(),
        sequence: row.sequence,
        stateVersion: payload.stateVersion,
        serverTime: Date.now(),
      });
    }
  }
  flushResolved();
}

async function deliverOutboxRowsToSocket(
  socket: WebSocket,
  rows: PopPersonRealtimeOutboxEvent[],
): Promise<void> {
  let resolved: ResolvedDelivery[] = [];
  const flushResolved = (): void => {
    if (resolved.length === 0) return;
    const actions = resolved;
    resolved = [];
    sendMessage(socket, {
      type: "effects:batch",
      actions: actions.map(({ action, event }) => ({ action, event })),
      sequence: actions[actions.length - 1].sequence,
      sequenceStart: actions[0].sequence,
      stateVersion: Math.max(
        ...actions.map(({ event }) => Number(event.stateVersion) || 0),
      ),
      serverTime: Date.now(),
    });
  };

  for (const row of rows) {
    if (row.topic === "action:resolved") {
      const delivery = await hydrateResolved(row);
      if (delivery) resolved.push(delivery);
      continue;
    }
    flushResolved();
    const payload = row.payload as unknown as PopPersonRealtimeNotification;
    if (payload.type === "action:queued") {
      const action = await getPopPersonAction(payload.roomId, payload.actionId);
      if (action) {
        sendMessage(socket, {
          type: "action:queued",
          action,
          actionId: payload.actionId,
          sequence: row.sequence,
          stateVersion: payload.stateVersion,
          serverTime: Date.now(),
        });
      }
    } else if (payload.type === "state:changed") {
      sendMessage(socket, {
        type: "snapshot",
        state: await getPopPersonState(),
        sequence: row.sequence,
        stateVersion: payload.stateVersion,
        serverTime: Date.now(),
      });
    } else if (payload.type === "action:cancelled") {
      sendMessage(socket, {
        type: "action:cancelled",
        actionId: payload.actionId,
        sequence: row.sequence,
        stateVersion: payload.stateVersion,
        serverTime: Date.now(),
      });
    }
  }
  flushResolved();
}

export async function registerPopPersonRealtime(
  webSocketServer: WebSocketServer,
): Promise<void> {
  const listener = await pool.connect();
  await listener.query(`LISTEN ${POP_PERSON_REALTIME_CHANNEL}`);
  let lastOutboxSequence = await getPopPersonRealtimeSequence();
  let deliveryChain = Promise.resolve();
  let drainAgain = false;

  const drainOutbox = async (): Promise<void> => {
    const startedAt = Date.now();
    const result = await getPopPersonRealtimeOutboxSince(lastOutboxSequence, 250);
    if (result.events.length === 0) return;
    await deliverOutboxRows(webSocketServer, result.events);
    await markPopPersonRealtimeOutboxPublished(result.events.map((event) => event.id));
    lastOutboxSequence = result.events[result.events.length - 1].sequence;
    observeMetric("realtime.outbox_to_gateway_ms", Date.now() - startedAt);
    setMetric("realtime.outbox_cursor", lastOutboxSequence);
    if (result.hasMore) drainAgain = true;
  };

  const scheduleDrain = (): void => {
    deliveryChain = deliveryChain
      .then(async () => {
        do {
          drainAgain = false;
          await drainOutbox();
        } while (drainAgain);
      })
      .catch((error) => {
        incrementMetric("realtime.delivery_errors");
        logger.error({ err: error }, "Failed to drain realtime outbox");
      });
  };

  const pollTimer = setInterval(scheduleDrain, 250);
  pollTimer.unref();
  const retentionTimer = setInterval(() => {
    void cleanupPopPersonRealtimeOutbox()
      .then((deleted) => {
        if (deleted > 0) logger.info({ deleted }, "Cleaned realtime outbox events");
      })
      .catch((error) => logger.warn({ err: error }, "Failed to clean realtime outbox"));
  }, 15 * 60 * 1000);
  retentionTimer.unref();
  listener.on("notification", (message) => {
    if (message.channel === POP_PERSON_REALTIME_CHANNEL) scheduleDrain();
  });
  scheduleDrain();

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
        sequence: await getPopPersonRealtimeSequence(),
        serverTime: Date.now(),
      });
    } catch (error) {
      logger.error({ err: error }, "Failed to send PopPerson realtime snapshot");
      socket.close(1011, "Realtime snapshot unavailable");
      return;
    }

    socket.on("message", (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString()) as {
          type?: string;
          sequence?: number;
          stateVersion?: number;
          clientTime?: number;
        };
        if (message.type === "resume") {
          const requestedSequence = Number(message.sequence ?? message.stateVersion);
          if (!Number.isFinite(requestedSequence) || requestedSequence < 0) return;
          incrementMetric("realtime.replay_requests");
          void getPopPersonRealtimeOutboxSince(requestedSequence, 500)
            .then(async (replay) => {
              if (replay.hasMore) {
                incrementMetric("realtime.replay_snapshots");
                sendMessage(socket, {
                  type: "snapshot",
                  state: await getPopPersonState(),
                  sequence: await getPopPersonRealtimeSequence(),
                  serverTime: Date.now(),
                });
                return;
              }
              if (replay.events.length > 0) {
                incrementMetric("realtime.replay_events", replay.events.length);
                await deliverOutboxRowsToSocket(socket, replay.events);
              }
            })
            .catch((error) => {
              incrementMetric("realtime.replay_errors");
              logger.warn({ err: error }, "Failed to replay PopPerson realtime events");
            });
          return;
        }
        if (message.type !== "clock:ping") return;
        sendMessage(socket, {
          type: "clock:pong",
          serverTime: Date.now(),
          clientTime: Number(message.clientTime) || undefined,
        });
      } catch {
        incrementMetric("realtime.malformed_client_messages");
      }
    });
  });
}