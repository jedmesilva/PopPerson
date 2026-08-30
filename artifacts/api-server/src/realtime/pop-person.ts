import type { WebSocketServer, WebSocket } from "ws";
import type { PopPersonState } from "@workspace/api-zod";
import type { PopPersonHitEvent } from "../lib/pop-person-store";
import {
  getPopPersonState,
  subscribePopPersonState,
} from "../lib/pop-person";

type PopPersonRealtimeMessage = {
  type: "snapshot" | "state:update" | "hit";
  state?: PopPersonState;
  event?: PopPersonHitEvent;
};

function sendMessage(socket: WebSocket, message: PopPersonRealtimeMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

export function registerPopPersonRealtime(
  webSocketServer: WebSocketServer,
): void {
  webSocketServer.on("connection", async (socket) => {
    sendMessage(socket, { type: "snapshot", state: await getPopPersonState() });
  });

  subscribePopPersonState((state, hitEvents) => {
    webSocketServer.clients.forEach((socket) => {
      for (const event of hitEvents) {
        sendMessage(socket, { type: "hit", event });
      }
      sendMessage(socket, { type: "state:update", state });
    });
  });
}