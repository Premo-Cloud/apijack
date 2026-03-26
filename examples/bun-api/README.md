# Example Bun API — Task Manager

A simple in-memory Task Manager REST API built with Bun's native HTTP server. Serves an OpenAPI 3.0 spec at `/v3/api-docs`. Designed for testing the `apijack` CLI framework.

## Start

```bash
bun run server.ts
# or
bun run start
```

Server runs on port 3456.

## Credentials

HTTP Basic Auth: `admin` / `password`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v3/api-docs` | OpenAPI 3.0 spec (no auth) |
| GET | `/tasks` | List tasks (`?status=open\|closed`) |
| GET | `/tasks/:id` | Get a task |
| POST | `/tasks` | Create a task |
| PUT | `/tasks/:id` | Update a task |
| DELETE | `/tasks/:id` | Delete a task |
| POST | `/tasks/:id/complete` | Mark task complete |
| GET | `/tags` | List tags |
| POST | `/tags` | Create a tag |
