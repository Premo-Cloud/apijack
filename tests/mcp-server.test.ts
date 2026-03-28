import { describe, test, expect, mock, beforeEach } from "bun:test";
import {
  getToolDefinitions,
  createHandlers,
  type McpServerOptions,
} from "../src/mcp-server";

// ── Fixture options ─────────────────────────────────────────────────

function makeOpts(overrides: Partial<McpServerOptions> = {}): McpServerOptions {
  return {
    cliName: "testcli",
    cliInvocation: ["/usr/bin/testcli"],
    generatedDir: "/fake/generated",
    routinesDir: "/fake/routines",
    ...overrides,
  };
}

// ── Tool definitions ────────────────────────────────────────────────

describe("getToolDefinitions()", () => {
  const tools = getToolDefinitions();

  test("returns exactly 13 tool definitions", () => {
    expect(tools).toHaveLength(13);
  });

  test("does not include removed run_command tool", () => {
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("run_command");
  });

  test("all tools have required fields", () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.inputSchema.properties).toBe("object");
    }
  });

  test("tool names match expected set", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "config_list",
      "config_switch",
      "create_routine",
      "describe_command",
      "generate",
      "get_config",
      "get_routine_templates",
      "get_spec",
      "list_commands",
      "list_routines",
      "run_commands",
      "run_routine",
      "setup",
    ]);
  });

  test("run_commands requires 'commands' parameter", () => {
    const tool = tools.find((t) => t.name === "run_commands")!;
    expect(tool.inputSchema.required).toContain("commands");
    expect(tool.inputSchema.properties).toHaveProperty("commands");
    expect(tool.inputSchema.properties).toHaveProperty("stop_on_error");
  });

  test("run_routine requires 'name' parameter", () => {
    const tool = tools.find((t) => t.name === "run_routine")!;
    expect(tool.inputSchema.required).toContain("name");
    expect(tool.inputSchema.properties).toHaveProperty("name");
    expect(tool.inputSchema.properties).toHaveProperty("set");
  });

  test("config_switch requires 'name' parameter", () => {
    const tool = tools.find((t) => t.name === "config_switch")!;
    expect(tool.inputSchema.required).toContain("name");
    expect(tool.inputSchema.properties).toHaveProperty("name");
  });

  test("list_commands has optional 'filter' parameter", () => {
    const tool = tools.find((t) => t.name === "list_commands")!;
    expect(tool.inputSchema.properties).toHaveProperty("filter");
    expect(tool.inputSchema.required).toBeUndefined();
  });

  test("parameterless tools have empty properties", () => {
    const parameterless = ["generate", "config_list", "list_routines", "get_config"];
    for (const name of parameterless) {
      const tool = tools.find((t) => t.name === name)!;
      expect(Object.keys(tool.inputSchema.properties)).toHaveLength(0);
    }
  });
});

// ── Handler: list_commands ──────────────────────────────────────────

describe("list_commands handler", () => {
  test("returns filtered results from command map", async () => {
    // Mock the import of command-map by using a real temp module
    const opts = makeOpts({ generatedDir: import.meta.dir + "/fixtures/mcp" });

    // Write a temporary command-map module
    const mapDir = import.meta.dir + "/fixtures/mcp";
    const { mkdirSync, writeFileSync } = await import("fs");
    mkdirSync(mapDir, { recursive: true });
    writeFileSync(
      mapDir + "/command-map.ts",
      `export const commandMap = {
  "admin list": { operationId: "listAdmins", pathParams: [], queryParams: [], hasBody: false, description: "List admins" },
  "admin create": { operationId: "createAdmin", pathParams: [], queryParams: [], hasBody: true },
  "matters list": { operationId: "listMatters", pathParams: [], queryParams: ["page"], hasBody: false, description: "List matters" },
  "matters get": { operationId: "getMatter", pathParams: ["id"], queryParams: [], hasBody: false },
};`,
    );

    const handlers = createHandlers(opts);
    const result = await handlers.list_commands({ filter: "admin" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("admin list");
    expect(result.content[0].text).toContain("admin create");
    expect(result.content[0].text).not.toContain("matters");
  });

  test("returns all commands when no filter given", async () => {
    const opts = makeOpts({ generatedDir: import.meta.dir + "/fixtures/mcp" });
    const handlers = createHandlers(opts);
    const result = await handlers.list_commands({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("admin list");
    expect(result.content[0].text).toContain("matters list");
  });

  test("returns message when no commands match filter", async () => {
    const opts = makeOpts({ generatedDir: import.meta.dir + "/fixtures/mcp" });
    const handlers = createHandlers(opts);
    const result = await handlers.list_commands({ filter: "nonexistent" });

    expect(result.content[0].text).toContain('No commands found matching "nonexistent"');
  });

  test("returns error when command map not available", async () => {
    const opts = makeOpts({ generatedDir: "/nonexistent/path" });
    const handlers = createHandlers(opts);
    const result = await handlers.list_commands({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Command map not available");
  });
});

// ── Handler: list_routines ──────────────────────────────────────────

describe("list_routines handler", () => {
  test("returns routine names from structured list", async () => {
    const { mkdirSync, writeFileSync } = await import("fs");
    const routinesDir = import.meta.dir + "/fixtures/mcp/routines";
    mkdirSync(routinesDir, { recursive: true });
    writeFileSync(
      routinesDir + "/test-routine.yaml",
      "name: test-routine\nsteps:\n  - name: step1\n    command: admin list\n",
    );

    const opts = makeOpts({ routinesDir });
    const handlers = createHandlers(opts);
    const result = await handlers.list_routines();

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("test-routine");
  });

  test("returns message when no routines found", async () => {
    const opts = makeOpts({ routinesDir: "/nonexistent/routines" });
    const handlers = createHandlers(opts);
    const result = await handlers.list_routines();

    expect(result.content[0].text).toContain("No routines found");
  });
});

// ── Handler: get_config ─────────────────────────────────────────────

describe("get_config handler", () => {
  test("returns config with password stripped", async () => {
    // Set up env vars so getActiveEnvConfig resolves via env
    const origUrl = process.env.TESTCLI_URL;
    const origUser = process.env.TESTCLI_USER;
    const origPass = process.env.TESTCLI_PASS;

    // getActiveEnvConfig reads from config file, not env vars.
    // We need a config file for this test. Create one.
    const { mkdirSync, writeFileSync, rmSync } = await import("fs");
    const { homedir } = await import("os");
    const configDir = homedir() + "/.testcli-mcp-test";
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configDir + "/config.json",
      JSON.stringify({
        active: "dev",
        environments: {
          dev: {
            url: "http://localhost:8080",
            user: "admin",
            password: "secret123",
            matterId: "42",
          },
        },
      }),
    );

    // Use a custom cli name that matches the config dir
    const opts = makeOpts({ cliName: "testcli-mcp-test" });
    const handlers = createHandlers(opts);
    const result = await handlers.get_config();

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.url).toBe("http://localhost:8080");
    expect(parsed.user).toBe("admin");
    expect(parsed.matterId).toBe("42");
    expect(parsed).not.toHaveProperty("password");

    // Cleanup
    rmSync(configDir, { recursive: true, force: true });
  });

  test("returns error when no config exists", async () => {
    const opts = makeOpts({ cliName: "nonexistent-cli-name-xyz" });
    const handlers = createHandlers(opts);
    const result = await handlers.get_config();

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No active environment");
  });
});

// ── Handler: run_commands ───────────────────────────────────────────

describe("run_commands handler", () => {
  test("constructs correct CLI args for each command", async () => {
    const spawnCalls: unknown[][] = [];
    const origSpawn = Bun.spawn;

    // @ts-ignore - mocking Bun.spawn
    Bun.spawn = (cmd: string[], _opts: any) => {
      spawnCalls.push(cmd);
      return {
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("ok"));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    };

    const opts = makeOpts();
    const handlers = createHandlers(opts);
    await handlers.run_commands({
      commands: [
        { command: "admin users create", args: { "--name": "test" } },
        { command: "matters list" },
      ],
    });

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0]).toEqual([
      "/usr/bin/testcli",
      "admin",
      "users",
      "create",
      "--name",
      "test",
    ]);
    expect(spawnCalls[1]).toEqual(["/usr/bin/testcli", "matters", "list"]);

    // @ts-ignore - restore
    Bun.spawn = origSpawn;
  });

  test("works with single command in array", async () => {
    const spawnCalls: unknown[][] = [];
    const origSpawn = Bun.spawn;

    // @ts-ignore
    Bun.spawn = (cmd: string[], _opts: any) => {
      spawnCalls.push(cmd);
      return {
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(""));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    };

    const opts = makeOpts();
    const handlers = createHandlers(opts);
    await handlers.run_commands({
      commands: [{ command: "matters list" }],
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toEqual(["/usr/bin/testcli", "matters", "list"]);

    // @ts-ignore
    Bun.spawn = origSpawn;
  });
});

// ── Handler: run_routine ────────────────────────────────────────────

describe("run_routine handler", () => {
  test("constructs correct CLI args with --set flags", async () => {
    const spawnCalls: unknown[][] = [];
    const origSpawn = Bun.spawn;

    // @ts-ignore
    Bun.spawn = (cmd: string[], opts: any) => {
      spawnCalls.push(cmd);
      return {
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("done"));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    };

    const opts = makeOpts();
    const handlers = createHandlers(opts);
    await handlers.run_routine({
      name: "load/quick",
      set: { matterId: "123", path: "/data" },
    });

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toEqual([
      "/usr/bin/testcli",
      "routine",
      "run",
      "load/quick",
      "--set",
      "matterId=123",
      "--set",
      "path=/data",
    ]);

    // @ts-ignore
    Bun.spawn = origSpawn;
  });

  test("constructs args without --set when set not provided", async () => {
    const spawnCalls: unknown[][] = [];
    const origSpawn = Bun.spawn;

    // @ts-ignore
    Bun.spawn = (cmd: string[], opts: any) => {
      spawnCalls.push(cmd);
      return {
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(""));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    };

    const opts = makeOpts();
    const handlers = createHandlers(opts);
    await handlers.run_routine({ name: "setup/init" });

    expect(spawnCalls[0]).toEqual([
      "/usr/bin/testcli",
      "routine",
      "run",
      "setup/init",
    ]);

    // @ts-ignore
    Bun.spawn = origSpawn;
  });
});

// ── Handler: config_list ────────────────────────────────────────────

describe("config_list handler", () => {
  test("constructs correct CLI invocation", async () => {
    const spawnCalls: unknown[][] = [];
    const origSpawn = Bun.spawn;

    // @ts-ignore
    Bun.spawn = (cmd: string[], opts: any) => {
      spawnCalls.push(cmd);
      return {
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("* dev\thttp://localhost\tadmin"));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    };

    const opts = makeOpts();
    const handlers = createHandlers(opts);
    const result = await handlers.config_list();

    expect(spawnCalls[0]).toEqual(["/usr/bin/testcli", "config", "list"]);
    expect(result.isError).toBeUndefined();

    // @ts-ignore
    Bun.spawn = origSpawn;
  });
});

// ── Handler: config_switch ──────────────────────────────────────────

describe("config_switch handler", () => {
  test("constructs correct CLI invocation", async () => {
    const spawnCalls: unknown[][] = [];
    const origSpawn = Bun.spawn;

    // @ts-ignore
    Bun.spawn = (cmd: string[], opts: any) => {
      spawnCalls.push(cmd);
      return {
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("Switched to 'staging'"));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    };

    const opts = makeOpts();
    const handlers = createHandlers(opts);
    const result = await handlers.config_switch({ name: "staging" });

    expect(spawnCalls[0]).toEqual([
      "/usr/bin/testcli",
      "config",
      "switch",
      "staging",
    ]);
    expect(result.isError).toBeUndefined();

    // @ts-ignore
    Bun.spawn = origSpawn;
  });
});

// ── Handler: generate ───────────────────────────────────────────────

describe("generate handler", () => {
  test("constructs correct CLI invocation", async () => {
    const spawnCalls: unknown[][] = [];
    const origSpawn = Bun.spawn;

    // @ts-ignore
    Bun.spawn = (cmd: string[], opts: any) => {
      spawnCalls.push(cmd);
      return {
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("Generated files written"));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        exited: Promise.resolve(0),
      };
    };

    const opts = makeOpts();
    const handlers = createHandlers(opts);
    const result = await handlers.generate();

    expect(spawnCalls[0]).toEqual([
      "/usr/bin/testcli",
      "generate",
    ]);
    expect(result.isError).toBeUndefined();

    // @ts-ignore
    Bun.spawn = origSpawn;
  });
});

// ── Handler: get_spec ───────────────────────────────────────────────

describe("get_spec handler", () => {
  test("counts interfaces and types from types.ts", async () => {
    const { mkdirSync, writeFileSync } = await import("fs");
    const specDir = import.meta.dir + "/fixtures/mcp/spec";
    mkdirSync(specDir, { recursive: true });
    writeFileSync(
      specDir + "/types.ts",
      [
        "// Auto-generated",
        "export interface UserDto {",
        "  id: number;",
        "  name: string;",
        "}",
        "",
        "export interface MatterDto {",
        "  id: number;",
        "}",
        "",
        "export type Status = 'active' | 'inactive';",
        "",
        "export type Role = 'admin' | 'user';",
        "",
        "export interface LoadDto {",
        "  loadId: number;",
        "}",
      ].join("\n"),
    );

    const opts = makeOpts({ generatedDir: specDir });
    const handlers = createHandlers(opts);
    const result = await handlers.get_spec({});

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("UserDto");
    expect(result.content[0].text).toContain("MatterDto");
    expect(result.content[0].text).toContain("LoadDto");
  });

  test("returns full content in verbose mode", async () => {
    const opts = makeOpts({ generatedDir: import.meta.dir + "/fixtures/mcp/spec" });
    const handlers = createHandlers(opts);
    const result = await handlers.get_spec({ verbose: true });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("export interface UserDto");
    expect(result.content[0].text).toContain("id: number");
  });

  test("returns error when types file not available", async () => {
    const opts = makeOpts({ generatedDir: "/nonexistent/path" });
    const handlers = createHandlers(opts);
    const result = await handlers.get_spec({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Types file not available");
  });
});

// ── Handler: setup ──────────────────────────────────────────────────

describe("setup handler", () => {
  test("stores credentials for localhost URL and attempts generate", async () => {
    const { mkdirSync, rmSync, readFileSync } = await import("fs");
    const { homedir } = await import("os");
    const configDir = homedir() + "/.testcli-mcp-setup";
    mkdirSync(configDir, { recursive: true });

    const opts = makeOpts({ cliName: "testcli-mcp-setup" });
    const handlers = createHandlers(opts);
    const result = await handlers.setup({
      name: "dev",
      url: "http://localhost:8080",
      user: "admin",
      password: "secret",
    });

    // Setup saves credentials then auto-runs generate (which fails in test — no real CLI)
    expect(result.content[0].text).toContain("dev");
    expect(result.content[0].text).toContain("configured");

    const config = JSON.parse(readFileSync(configDir + "/config.json", "utf-8"));
    expect(config.active).toBe("dev");
    expect(config.environments.dev.url).toBe("http://localhost:8080");
    expect(config.environments.dev.password).toBe("secret");

    rmSync(configDir, { recursive: true, force: true });
  });

  test("rejects production URL", async () => {
    const opts = makeOpts({ cliName: "testcli-mcp-prod" });
    const handlers = createHandlers(opts);
    const result = await handlers.setup({
      name: "prod",
      url: "https://api.example.com",
      user: "admin",
      password: "secret",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Production API detected");
    expect(result.content[0].text).toContain("environment variable");
  });

  test("allows IP in configured CIDRs", async () => {
    const { mkdirSync, rmSync, readFileSync } = await import("fs");
    const { homedir } = await import("os");
    const configDir = homedir() + "/.testcli-mcp-cidr";
    mkdirSync(configDir, { recursive: true });

    const opts = makeOpts({
      cliName: "testcli-mcp-cidr",
      allowedCidrs: ["192.168.1.0/24"],
    });
    const handlers = createHandlers(opts);
    const result = await handlers.setup({
      name: "internal",
      url: "http://192.168.1.50:8080",
      user: "admin",
      password: "secret",
    });

    // Setup saves credentials then auto-runs generate (which fails in test — no real CLI)
    expect(result.content[0].text).toContain("configured");

    const config = JSON.parse(readFileSync(configDir + "/config.json", "utf-8"));
    expect(config.environments.internal.url).toBe("http://192.168.1.50:8080");

    rmSync(configDir, { recursive: true, force: true });
  });
});
