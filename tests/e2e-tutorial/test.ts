#!/usr/bin/env bun
/**
 * E2E test that drives the apijack MCP server through the full tutorial workflow.
 *
 * Exercises: setup -> generate -> create 50 TODOs -> color each -> delete in reverse -> verify empty.
 * Uses the official MCP SDK Client over stdio — same transport Claude Code uses.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const TODO_COUNT = 50;

// ── Helpers ────────────────────────────────────────────────────────────

function randomHex(): string {
  const r = Math.floor(Math.random() * 256);
  const g = Math.floor(Math.random() * 256);
  const b = Math.floor(Math.random() * 256);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (result.isError) {
    throw new Error(`Tool ${name} failed: ${text}`);
  }
  return text;
}

// ── Main ───────────────────────────────────────────────────────────────

const MCP_SERVER = process.env.MCP_SERVER_PATH ?? "/apijack/src/mcp-server-entry.ts";
const PROJECT_DIR = process.env.PROJECT_DIR ?? "/tutorial";

console.log("=== apijack E2E Tutorial Test ===\n");

// 1. Connect to MCP server
console.log("Connecting to MCP server...");
const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", MCP_SERVER],
  cwd: PROJECT_DIR,
});

const client = new Client({ name: "e2e-test", version: "1.0.0" });
await client.connect(transport);
console.log("Connected.\n");

// 2. Verify tools are available
const { tools } = await client.listTools();
const toolNames = tools.map((t) => t.name);
console.log(`Available tools: ${toolNames.join(", ")}`);
for (const required of ["setup", "generate", "run_command", "list_commands"]) {
  if (!toolNames.includes(required)) {
    throw new Error(`Required tool "${required}" not found`);
  }
}
console.log("");

// 3. Setup — configure the dev environment
console.log("Step 1: Setup (configure dev environment)");
const setupResult = await callTool(client, "setup", {
  name: "dev",
  url: "http://localhost:3456",
  user: "admin",
  password: "admin",
});
console.log(`  ${setupResult}\n`);

// 4. Generate — codegen from live spec
console.log("Step 2: Generate CLI from live OpenAPI spec");
const genResult = await callTool(client, "generate");
console.log(`  ${genResult.split("\n")[0]}\n`);

// 5. List commands — verify codegen produced the expected commands
console.log("Step 3: Verify generated commands");
const cmdsResult = await callTool(client, "list_commands");
for (const expected of ["todos list", "todos create", "todos get", "todos patch", "todos delete"]) {
  if (!cmdsResult.includes(expected)) {
    throw new Error(`Expected command "${expected}" not found in: ${cmdsResult}`);
  }
}
console.log("  All expected commands present.\n");

// 6. Create 50 TODOs
console.log(`Step 4: Create ${TODO_COUNT} TODOs`);
const createdIds: string[] = [];
for (let i = 1; i <= TODO_COUNT; i++) {
  const result = await callTool(client, "run_command", {
    command: "todos create",
    args: { "--title": `Todo ${i}` },
  });
  const parsed = JSON.parse(result);
  createdIds.push(parsed.id);
  process.stdout.write(`\r  Created ${i}/${TODO_COUNT}`);
}
console.log("");

// Verify count
const listAfterCreate = await callTool(client, "run_command", { command: "todos list" });
const todosAfterCreate = JSON.parse(listAfterCreate);
if (todosAfterCreate.length !== TODO_COUNT) {
  throw new Error(`Expected ${TODO_COUNT} TODOs, got ${todosAfterCreate.length}`);
}
console.log(`  Verified: ${todosAfterCreate.length} TODOs exist.\n`);

// 7. Update each TODO with a random color in random order
console.log(`Step 5: Color ${TODO_COUNT} TODOs in random order`);
const shuffledIds = shuffle(createdIds);
for (let i = 0; i < shuffledIds.length; i++) {
  const color = randomHex();
  await callTool(client, "run_command", {
    command: `todos patch ${shuffledIds[i]}`,
    args: { "--color": color },
  });
  process.stdout.write(`\r  Colored ${i + 1}/${TODO_COUNT}`);
}
console.log("");

// Verify all have non-white colors
const listAfterColor = await callTool(client, "run_command", { command: "todos list" });
const todosAfterColor = JSON.parse(listAfterColor);
const allColored = todosAfterColor.every((t: { color: string }) => t.color !== "#ffffff");
if (!allColored) {
  throw new Error("Not all TODOs were colored");
}
console.log("  Verified: all TODOs have been colored.\n");

// 8. Delete all TODOs in reverse creation order
console.log(`Step 6: Delete ${TODO_COUNT} TODOs in reverse order`);
const reversedIds = [...createdIds].reverse();
for (let i = 0; i < reversedIds.length; i++) {
  await callTool(client, "run_command", {
    command: `todos delete ${reversedIds[i]}`,
  });
  process.stdout.write(`\r  Deleted ${i + 1}/${TODO_COUNT}`);
}
console.log("");

// 9. Verify empty
const listAfterDelete = await callTool(client, "run_command", { command: "todos list" });
const todosAfterDelete = JSON.parse(listAfterDelete);
if (todosAfterDelete.length !== 0) {
  throw new Error(`Expected 0 TODOs after delete, got ${todosAfterDelete.length}`);
}
console.log("  Verified: all TODOs deleted.\n");

// Done
await client.close();
console.log("=== E2E Tutorial Test PASSED ===");
process.exit(0);
