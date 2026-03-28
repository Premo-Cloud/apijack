export function getSpec() {
  return {
    openapi: "3.0.3",
    info: {
      title: "TODO API",
      version: "1.0.0",
      description: "A simple TODO API for the apijack tutorial",
    },
    servers: [{ url: "http://localhost:3456" }],
    tags: [{ name: "todos", description: "TODO operations" }],
    paths: {
      "/todos": {
        get: {
          operationId: "listTodos",
          tags: ["todos"],
          summary: "List all TODOs",
          responses: {
            "200": {
              description: "List of TODOs",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: { $ref: "#/components/schemas/Todo" },
                  },
                },
              },
            },
          },
          security: [{ basicAuth: [] }],
        },
        post: {
          operationId: "createTodo",
          tags: ["todos"],
          summary: "Create a TODO",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateTodo" },
              },
            },
          },
          responses: {
            "201": {
              description: "Created TODO",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Todo" },
                },
              },
            },
          },
          security: [{ basicAuth: [] }],
        },
      },
      "/todos/{id}": {
        get: {
          operationId: "getTodo",
          tags: ["todos"],
          summary: "Get a TODO by ID",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "TODO ID",
            },
          ],
          responses: {
            "200": {
              description: "TODO found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Todo" },
                },
              },
            },
            "404": { description: "TODO not found" },
          },
          security: [{ basicAuth: [] }],
        },
        patch: {
          operationId: "updateTodo",
          tags: ["todos"],
          summary: "Update a TODO",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "TODO ID",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateTodo" },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated TODO",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Todo" },
                },
              },
            },
            "404": { description: "TODO not found" },
          },
          security: [{ basicAuth: [] }],
        },
        delete: {
          operationId: "deleteTodo",
          tags: ["todos"],
          summary: "Delete a TODO",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "TODO ID",
            },
          ],
          responses: {
            "204": { description: "TODO deleted" },
            "404": { description: "TODO not found" },
          },
          security: [{ basicAuth: [] }],
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
        Todo: {
          type: "object",
          properties: {
            id: { type: "string", description: "Unique identifier" },
            title: { type: "string", description: "TODO title" },
            completed: {
              type: "boolean",
              description: "Completion status",
            },
            color: {
              type: "string",
              description: "Background color (hex string)",
            },
          },
          required: ["id", "title", "completed", "color"],
        },
        CreateTodo: {
          type: "object",
          properties: {
            title: { type: "string", description: "TODO title" },
          },
          required: ["title"],
        },
        UpdateTodo: {
          type: "object",
          properties: {
            title: { type: "string", description: "TODO title" },
            completed: {
              type: "boolean",
              description: "Completion status",
            },
            color: {
              type: "string",
              description: "Background color (hex string)",
            },
          },
        },
      },
    },
  };
}
