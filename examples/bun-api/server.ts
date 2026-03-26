// Task Manager example API — Bun native HTTP server
// Used for testing the apijack CLI framework

// ── Data model ──────────────────────────────────────────────────────────────

interface Task {
  id: number;
  title: string;
  description: string;
  status: "open" | "in_progress" | "closed";
  priority: "low" | "medium" | "high";
  tags: string[];
  createdAt: string;
}

interface Tag {
  id: number;
  name: string;
  color: string;
}

// ── In-memory storage with seed data ────────────────────────────────────────

let nextTaskId = 4;
let nextTagId = 4;

const tasks: Task[] = [
  {
    id: 1,
    title: "Set up CI pipeline",
    description: "Configure GitHub Actions for the project",
    status: "open",
    priority: "high",
    tags: ["devops"],
    createdAt: "2026-03-20T10:00:00Z",
  },
  {
    id: 2,
    title: "Write unit tests",
    description: "Cover the core modules with tests",
    status: "in_progress",
    priority: "medium",
    tags: ["testing", "backend"],
    createdAt: "2026-03-21T14:30:00Z",
  },
  {
    id: 3,
    title: "Update README",
    description: "Add usage examples and API docs",
    status: "closed",
    priority: "low",
    tags: ["docs"],
    createdAt: "2026-03-22T09:15:00Z",
  },
];

const tags: Tag[] = [
  { id: 1, name: "devops", color: "#3b82f6" },
  { id: 2, name: "testing", color: "#22c55e" },
  { id: 3, name: "backend", color: "#a855f7" },
];

// ── Auth ────────────────────────────────────────────────────────────────────

const VALID_USER = "admin";
const VALID_PASS = "password";

function checkAuth(req: Request): Response | null {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Basic ")) {
    return Response.json({ error: "Unauthorized" }, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Task Manager API"' },
    });
  }
  const decoded = atob(auth.slice(6));
  const [user, pass] = decoded.split(":");
  if (user !== VALID_USER || pass !== VALID_PASS) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }
  return null; // auth OK
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function parseId(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

// ── Route handling ──────────────────────────────────────────────────────────

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // OpenAPI spec — no auth required
  if (method === "GET" && path === "/v3/api-docs") {
    return json(openapiSpec);
  }

  // All other routes require auth
  const authError = checkAuth(req);
  if (authError) return authError;

  // ── Tasks ───────────────────────────────────────────────────────────────

  // GET /tasks
  if (method === "GET" && path === "/tasks") {
    const status = url.searchParams.get("status");
    if (status) {
      const filtered = tasks.filter((t) => t.status === status);
      return json(filtered);
    }
    return json(tasks);
  }

  // GET /tasks/:id
  const taskGetMatch = path.match(/^\/tasks\/(\d+)$/);
  if (method === "GET" && taskGetMatch) {
    const id = parseId(taskGetMatch[1]);
    const task = tasks.find((t) => t.id === id);
    if (!task) return json({ error: "Task not found" }, 404);
    return json(task);
  }

  // POST /tasks
  if (method === "POST" && path === "/tasks") {
    const body = await req.json() as Record<string, unknown>;
    if (!body.title || typeof body.title !== "string") {
      return json({ error: "title is required" }, 400);
    }
    const task: Task = {
      id: nextTaskId++,
      title: body.title as string,
      description: (body.description as string) ?? "",
      status: "open",
      priority: (body.priority as Task["priority"]) ?? "medium",
      tags: [],
      createdAt: new Date().toISOString(),
    };
    tasks.push(task);
    return json(task, 201);
  }

  // PUT /tasks/:id
  const taskPutMatch = path.match(/^\/tasks\/(\d+)$/);
  if (method === "PUT" && taskPutMatch) {
    const id = parseId(taskPutMatch[1]);
    const task = tasks.find((t) => t.id === id);
    if (!task) return json({ error: "Task not found" }, 404);
    const body = await req.json() as Record<string, unknown>;
    if (body.title !== undefined) task.title = body.title as string;
    if (body.description !== undefined) task.description = body.description as string;
    if (body.status !== undefined) task.status = body.status as Task["status"];
    if (body.priority !== undefined) task.priority = body.priority as Task["priority"];
    if (body.tags !== undefined) task.tags = body.tags as string[];
    return json(task);
  }

  // DELETE /tasks/:id
  const taskDeleteMatch = path.match(/^\/tasks\/(\d+)$/);
  if (method === "DELETE" && taskDeleteMatch) {
    const id = parseId(taskDeleteMatch[1]);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return json({ error: "Task not found" }, 404);
    const [removed] = tasks.splice(idx, 1);
    return json(removed);
  }

  // POST /tasks/:id/complete
  const taskCompleteMatch = path.match(/^\/tasks\/(\d+)\/complete$/);
  if (method === "POST" && taskCompleteMatch) {
    const id = parseId(taskCompleteMatch[1]);
    const task = tasks.find((t) => t.id === id);
    if (!task) return json({ error: "Task not found" }, 404);
    task.status = "closed";
    return json(task);
  }

  // ── Tags ────────────────────────────────────────────────────────────────

  // GET /tags
  if (method === "GET" && path === "/tags") {
    return json(tags);
  }

  // POST /tags
  if (method === "POST" && path === "/tags") {
    const body = await req.json() as Record<string, unknown>;
    if (!body.name || typeof body.name !== "string") {
      return json({ error: "name is required" }, 400);
    }
    const tag: Tag = {
      id: nextTagId++,
      name: body.name as string,
      color: (body.color as string) ?? "#6b7280",
    };
    tags.push(tag);
    return json(tag, 201);
  }

  // ── 404 ─────────────────────────────────────────────────────────────────

  return json({ error: "Not found" }, 404);
}

// ── OpenAPI 3.0 spec ────────────────────────────────────────────────────────

const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Task Manager API",
    description: "A simple task manager for testing apijack CLI generation",
    version: "1.0.0",
  },
  servers: [{ url: "http://localhost:3456", description: "Local dev" }],
  security: [{ basicAuth: [] }],
  tags: [
    { name: "tasks", description: "Task operations" },
    { name: "tags", description: "Tag operations" },
  ],
  paths: {
    "/tasks": {
      get: {
        operationId: "listTasks",
        summary: "List all tasks",
        tags: ["tasks"],
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["open", "in_progress", "closed"] },
            description: "Filter tasks by status",
          },
        ],
        responses: {
          "200": {
            description: "List of tasks",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Task" } },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        operationId: "createTask",
        summary: "Create a new task",
        tags: ["tasks"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateTask" },
            },
          },
        },
        responses: {
          "201": {
            description: "Task created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Task" },
              },
            },
          },
          "400": { description: "Validation error" },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/tasks/{id}": {
      get: {
        operationId: "getTask",
        summary: "Get a task by ID",
        tags: ["tasks"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Task ID",
          },
        ],
        responses: {
          "200": {
            description: "Task details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Task" },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "404": { description: "Task not found" },
        },
      },
      put: {
        operationId: "updateTask",
        summary: "Update a task",
        tags: ["tasks"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Task ID",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateTask" },
            },
          },
        },
        responses: {
          "200": {
            description: "Task updated",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Task" },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "404": { description: "Task not found" },
        },
      },
      delete: {
        operationId: "deleteTask",
        summary: "Delete a task",
        tags: ["tasks"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Task ID",
          },
        ],
        responses: {
          "200": {
            description: "Deleted task",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Task" },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "404": { description: "Task not found" },
        },
      },
    },
    "/tasks/{id}/complete": {
      post: {
        operationId: "completeTask",
        summary: "Mark a task as complete",
        tags: ["tasks"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer" },
            description: "Task ID",
          },
        ],
        responses: {
          "200": {
            description: "Task marked as complete",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Task" },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "404": { description: "Task not found" },
        },
      },
    },
    "/tags": {
      get: {
        operationId: "listTags",
        summary: "List all tags",
        tags: ["tags"],
        responses: {
          "200": {
            description: "List of tags",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Tag" } },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        operationId: "createTag",
        summary: "Create a new tag",
        tags: ["tags"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateTag" },
            },
          },
        },
        responses: {
          "201": {
            description: "Tag created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Tag" },
              },
            },
          },
          "400": { description: "Validation error" },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      basicAuth: {
        type: "http",
        scheme: "basic",
      },
    },
    schemas: {
      Task: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          title: { type: "string", example: "Set up CI pipeline" },
          description: { type: "string", example: "Configure GitHub Actions for the project" },
          status: {
            type: "string",
            enum: ["open", "in_progress", "closed"],
            example: "open",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            example: "high",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            example: ["devops"],
          },
          createdAt: {
            type: "string",
            format: "date-time",
            example: "2026-03-20T10:00:00Z",
          },
        },
        required: ["id", "title", "description", "status", "priority", "tags", "createdAt"],
      },
      CreateTask: {
        type: "object",
        properties: {
          title: { type: "string", example: "New task" },
          description: { type: "string", example: "Task description" },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
            default: "medium",
            example: "medium",
          },
        },
        required: ["title"],
      },
      UpdateTask: {
        type: "object",
        properties: {
          title: { type: "string", example: "Updated title" },
          description: { type: "string", example: "Updated description" },
          status: {
            type: "string",
            enum: ["open", "in_progress", "closed"],
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
          tags: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      Tag: {
        type: "object",
        properties: {
          id: { type: "integer", example: 1 },
          name: { type: "string", example: "devops" },
          color: { type: "string", example: "#3b82f6" },
        },
        required: ["id", "name", "color"],
      },
      CreateTag: {
        type: "object",
        properties: {
          name: { type: "string", example: "frontend" },
          color: { type: "string", default: "#6b7280", example: "#f59e0b" },
        },
        required: ["name"],
      },
    },
  },
};

// ── Start server ────────────────────────────────────────────────────────────

const PORT = 3456;

Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`Task Manager API running on http://localhost:${PORT}`);
console.log(`OpenAPI spec: http://localhost:${PORT}/v3/api-docs`);
console.log(`Auth: admin / password`);
