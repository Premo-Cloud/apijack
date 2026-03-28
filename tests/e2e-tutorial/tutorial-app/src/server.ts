import { checkAuth, unauthorizedResponse } from "./auth";
import { handleTodos } from "./routes/todos";
import { getSpec } from "./openapi";
import { addClient, removeClient } from "./ws";

const server = Bun.serve({
  port: 3456,
  async fetch(req, server) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Serve UI
    if (pathname === "/") {
      return new Response(Bun.file("public/index.html"), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // OpenAPI spec (no auth)
    if (pathname === "/v3/api-docs") {
      return Response.json(getSpec());
    }

    // WebSocket upgrade (no auth)
    if (pathname === "/ws") {
      if (server.upgrade(req)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Auth-protected API routes
    if (pathname.startsWith("/todos")) {
      if (!checkAuth(req)) return unauthorizedResponse();
      return handleTodos(req, pathname);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
  websocket: {
    open(ws) {
      addClient(ws);
    },
    close(ws) {
      removeClient(ws);
    },
    message() {},
  },
});

console.log(`TODO API running at http://localhost:${server.port}`);
