import {
  listTodos,
  getTodo,
  createTodo,
  updateTodo,
  deleteTodo,
} from "../store";
import { broadcast } from "../ws";

export async function handleTodos(
  req: Request,
  pathname: string
): Promise<Response> {
  const match = pathname.match(/^\/todos(?:\/(.+))?$/);
  if (!match) return Response.json({ error: "Not found" }, { status: 404 });

  const id = match[1];
  const method = req.method;

  // Collection routes: GET /todos, POST /todos
  if (!id) {
    if (method === "GET") {
      return Response.json(listTodos());
    }
    if (method === "POST") {
      const body = (await req.json()) as { title?: string };
      if (!body.title) {
        return Response.json(
          { error: "title is required" },
          { status: 400 }
        );
      }
      const todo = await createTodo(body.title);
      broadcast("todo:created", todo);
      return Response.json(todo, { status: 201 });
    }
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  // Item routes: GET/PATCH/DELETE /todos/:id
  if (method === "GET") {
    const todo = getTodo(id);
    if (!todo) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(todo);
  }

  if (method === "PATCH") {
    const body = (await req.json()) as {
      title?: string;
      completed?: boolean;
      color?: string;
    };
    const todo = await updateTodo(id, body);
    if (!todo) return Response.json({ error: "Not found" }, { status: 404 });
    broadcast("todo:updated", todo);
    return Response.json(todo);
  }

  if (method === "DELETE") {
    const deleted = await deleteTodo(id);
    if (!deleted)
      return Response.json({ error: "Not found" }, { status: 404 });
    broadcast("todo:deleted", { id });
    return new Response(null, { status: 204 });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
