import type { WebSocketServer, WebSocket } from "ws";
import type { PopPersonState } from "@workspace/api-zod";
import {
  getPopPersonState,
  subscribePopPersonState,
} from "../lib/pop-person";

type PopPersonRealtimeMessage = {
  type: "snapshot" | "state:update";
  state: PopPersonState;
};

function sendState(socket: WebSocket, type: PopPersonRealtimeMessage["type"], state: PopPersonState): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ type, state }));
}

export function registerPopPersonRealtime(
  webSocketServer: WebSocketServer,
): void {
  webSocketServer.on("connection", async (socket) => {
    sendState(socket, "snapshot", await getPopPersonState());
  });

  subscribePopPersonState((state) => {
    webSocketServer.clients.forEach((socket) => {
      sendState(socket, "state:update", state);
    });
  });
}