import type { WebSocketServer, WebSocket } from "ws";
import type { PopPersonState } from "@workspace/api-zod";
import type { PopPersonHitEvent } from "../lib/pop-person-store";
import {
  getPopPersonState,
  subscribePopPersonState,
} from "../lib/pop-person";

type PopPersonRealtimeMessage = {
  type: "snapshot" | "state:update" | "hit" | "clock:pong";
  state?: PopPersonState;
  event?: PopPersonHitEvent;
  serverTime?: number;
  clientTime?: number;
};

function sendMessage(socket: WebSocket, message: PopPersonRealtimeMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

export function registerPopPersonRealtime(
  webSocketServer: WebSocketServer,
): void {
  webSocketServer.on("connection", async (socket) => {
    sendMessage(socket, {
      type: "snapshot",
      state: await getPopPersonState(),
      serverTime: Date.now(),
    });
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

  subscribePopPersonState((state, hitEvents) => {
    const serverTime = Date.now();
    webSocketServer.clients.forEach((socket) => {
      for (const event of hitEvents) {
        sendMessage(socket, { type: "hit", event, serverTime });
      }
      sendMessage(socket, { type: "state:update", state, serverTime });
    });
  });
}