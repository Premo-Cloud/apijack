import type { ServerWebSocket } from "bun";

const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>): void {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>): void {
  clients.delete(ws);
}

export function broadcast(event: string, todo: unknown): void {
  const message = JSON.stringify({ event, todo });
  for (const client of clients) {
    client.send(message);
  }
}
