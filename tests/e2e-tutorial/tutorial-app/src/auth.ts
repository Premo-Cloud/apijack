const USERNAME = "admin";
const PASSWORD = "admin";

export function checkAuth(req: Request): boolean {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Basic ")) return false;
  const decoded = atob(header.slice(6));
  const [user, pass] = decoded.split(":");
  return user === USERNAME && pass === PASSWORD;
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Basic realm="TODO API"',
    },
  });
}
