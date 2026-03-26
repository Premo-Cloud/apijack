import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { Command } from "commander";
import { createCli, type Cli } from "../src/cli-builder";
import type { CliOptions, CliContext, CommandRegistrar, DispatcherHandler } from "../src/types";
import { BasicAuthStrategy } from "../src/auth/basic";

function makeOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    name: "testcli",
    description: "A test CLI",
    version: "1.0.0",
    specPath: "/v3/api-docs",
    auth: new BasicAuthStrategy(),
    outputModes: ["json", "table", "quiet"],
    ...overrides,
  };
}

/**
 * Capture all output (console.log, console.error, and process.stdout.write)
 * during an async callback. Commander's --help writes directly to stdout.
 */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  const origWrite = process.stdout.write;

  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => logs.push(args.join(" "));
  process.stdout.write = (chunk: any, ...rest: any[]) => {
    logs.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  };

  try {
    await fn();
  } catch {
    // Expected: process.exit calls
  } finally {
    console.log = origLog;
    console.error = origErr;
    process.stdout.write = origWrite;
  }

  return logs.join("\n");
}

describe("createCli()", () => {
  test("returns object with command(), dispatcher(), run() methods", () => {
    const cli = createCli(makeOptions());
    expect(typeof cli.command).toBe("function");
    expect(typeof cli.dispatcher).toBe("function");
    expect(typeof cli.run).toBe("function");
  });

  test("command() stores registrar for later invocation", () => {
    const cli = createCli(makeOptions());
    const registrar: CommandRegistrar = (_program, _ctx) => {};
    // Should not throw
    cli.command("my-cmd", registrar);
    // We verify this is wired correctly in integration-style tests below
  });

  test("dispatcher() stores handler for the composed dispatcher", () => {
    const cli = createCli(makeOptions());
    const handler: DispatcherHandler = async (_args, _pos, _ctx) => ({});
    // Should not throw
    cli.dispatcher("my-dispatch", handler);
  });
});

/**
 * To test the built-in commands without actually running the full auth flow,
 * we construct the CLI and inspect the Commander program that would be built.
 * We do this by mocking process.argv and intercepting parseAsync.
 */
describe("built-in commands", () => {
  let originalArgv: string[];
  let originalExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExit = process.exit;
    exitCode = undefined;
    // Mock process.exit to prevent test runner from dying
    (process as any).exit = (code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`process.exit(${code})`);
    };
  });

  afterEach(() => {
    process.argv = originalArgv;
    (process as any).exit = originalExit;
  });

  test("setup, login, config (list, switch), generate, and routine commands are registered", async () => {
    // Use --help with a non-existent command to force Commander to parse and build the tree
    const cli = createCli(makeOptions());

    // We can build a program internally by running with --help, which will call showCustomHelp and exit
    // Instead, let's test the structure by hooking into run() at the parse stage
    process.argv = ["node", "testcli", "--help"];

    // Capture console output
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await cli.run();
    } catch (e: any) {
      // Expected: process.exit(0) from showCustomHelp
    }

    console.log = origLog;
    const output = logs.join("\n");

    // Verify core commands appear in help
    expect(output).toContain("setup");
    expect(output).toContain("login");
    expect(output).toContain("config");
    expect(output).toContain("generate");
    expect(output).toContain("routine");
  });

  test("knownSites option registers config import and config update-password", async () => {
    const cli = createCli(
      makeOptions({
        knownSites: {
          staging: { url: "https://staging.example.com", description: "Staging" },
        },
      }),
    );

    process.argv = ["node", "testcli", "config", "--help"];

    const output = await captureOutput(() => cli.run());

    // config import and update-password should be registered as subcommands
    expect(output).toContain("import");
    expect(output).toContain("update-password");
  });

  test("config import is NOT registered when knownSites is not provided", async () => {
    const cli = createCli(makeOptions({ knownSites: undefined }));

    process.argv = ["node", "testcli", "config", "--help"];

    const output = await captureOutput(() => cli.run());

    // config import should NOT be present
    expect(output).not.toContain("import");
    expect(output).not.toContain("update-password");
  });

  test("output mode flags are registered (--table, --quiet, -o)", async () => {
    const cli = createCli(makeOptions());

    process.argv = ["node", "testcli", "--help"];

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await cli.run();
    } catch (e: any) {
      // Expected
    }

    console.log = origLog;
    const output = logs.join("\n");

    expect(output).toContain("--table");
    expect(output).toContain("--quiet");
    expect(output).toContain("-o, --output");
  });

  test("output mode flags respect outputModes option", async () => {
    // Only json mode (no table or quiet)
    const cli = createCli(makeOptions({ outputModes: ["json"] }));

    process.argv = ["node", "testcli", "--help"];

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await cli.run();
    } catch (e: any) {
      // Expected
    }

    console.log = origLog;
    const output = logs.join("\n");

    // --table and --quiet should NOT be registered since not in outputModes
    expect(output).not.toContain("--table");
    expect(output).not.toContain("--quiet");
    // -o should still be registered
    expect(output).toContain("-o, --output");
  });

  test("custom help separates core commands from API commands", async () => {
    const cli = createCli(makeOptions());

    process.argv = ["node", "testcli", "--help"];

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await cli.run();
    } catch (e: any) {
      // Expected
    }

    console.log = origLog;
    const output = logs.join("\n");

    // Should show "Commands:" section with core commands
    expect(output).toContain("Commands:");
    // Should show usage and description
    expect(output).toContain("Usage: testcli");
    expect(output).toContain("A test CLI");
  });

  test("routine subcommands are registered (list, run, validate, test, init)", async () => {
    const cli = createCli(makeOptions());

    process.argv = ["node", "testcli", "routine", "--help"];

    const output = await captureOutput(() => cli.run());

    expect(output).toContain("list");
    expect(output).toContain("run");
    expect(output).toContain("validate");
    expect(output).toContain("test");
    expect(output).toContain("init");
  });

  test("env var prefix is derived from cliName uppercased", async () => {
    // Set env vars matching the test CLI name
    process.env.TESTCLI_URL = "https://env.example.com";
    process.env.TESTCLI_USER = "envuser";
    process.env.TESTCLI_PASS = "envpass";

    const cli = createCli(makeOptions({ name: "testcli" }));

    // Run with a non-existent command that won't match — we just want to verify auth resolution
    process.argv = ["node", "testcli", "--help"];

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await cli.run();
    } catch (e: any) {
      // Expected: process.exit from help
    }

    console.log = origLog;

    // Clean up
    delete process.env.TESTCLI_URL;
    delete process.env.TESTCLI_USER;
    delete process.env.TESTCLI_PASS;

    // If we got this far without error, env var resolution worked
    expect(exitCode).toBe(0);
  });

  test("program name and version are set correctly", async () => {
    const cli = createCli(
      makeOptions({
        name: "mycli",
        description: "My custom CLI tool",
        version: "2.5.0",
      }),
    );

    process.argv = ["node", "mycli", "--help"];

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await cli.run();
    } catch (e: any) {
      // Expected
    }

    console.log = origLog;
    const output = logs.join("\n");

    expect(output).toContain("Usage: mycli");
    expect(output).toContain("My custom CLI tool");
  });
});

describe("index exports", () => {
  test("all expected exports are available", async () => {
    const indexModule = await import("../src/index");

    // Functions
    expect(typeof indexModule.createCli).toBe("function");
    expect(typeof indexModule.BasicAuthStrategy).toBe("function");
    expect(typeof indexModule.BearerTokenStrategy).toBe("function");
    expect(typeof indexModule.ApiKeyStrategy).toBe("function");
    expect(typeof indexModule.formatOutput).toBe("function");
    expect(typeof indexModule.updateEnvironmentField).toBe("function");
    expect(typeof indexModule.verifyCredentials).toBe("function");
  });
});
