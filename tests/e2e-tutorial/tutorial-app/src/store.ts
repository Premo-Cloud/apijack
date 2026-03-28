export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  color: string;
}

const todos = new Map<string, Todo>();
const DELAY_MS = 200;

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, DELAY_MS));
}

export function listTodos(): Todo[] {
  return Array.from(todos.values());
}

export function getTodo(id: string): Todo | undefined {
  return todos.get(id);
}

export async function createTodo(title: string): Promise<Todo> {
  await delay();
  const todo: Todo = {
    id: crypto.randomUUID(),
    title,
    completed: false,
    color: "#ffffff",
  };
  todos.set(todo.id, todo);
  return todo;
}

export async function updateTodo(
  id: string,
  updates: Partial<Pick<Todo, "title" | "completed" | "color">>
): Promise<Todo | undefined> {
  await delay();
  const todo = todos.get(id);
  if (!todo) return undefined;
  Object.assign(todo, updates);
  return todo;
}

export async function deleteTodo(id: string): Promise<boolean> {
  await delay();
  return todos.delete(id);
}

export function clearTodos(): void {
  todos.clear();
}
