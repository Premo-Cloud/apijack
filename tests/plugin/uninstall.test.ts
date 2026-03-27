import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { installPlugin } from "../../src/plugin/install";
import { uninstallPlugin } from "../../src/plugin/uninstall";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testRoot = join(tmpdir(), "apijack-uninstall-test-" + Date.now());
const testClaudeDir = join(testRoot, ".claude");
const testDataDir = join(testRoot, ".apijack");

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("uninstallPlugin()", () => {
  beforeEach(async () => {
    mkdirSync(testRoot, { recursive: true });
    await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir: join(import.meta.dir, "../.."),
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  test("removes plugin from installed_plugins.json", async () => {
    await uninstallPlugin({ claudeDir: testClaudeDir });

    const installed = readJson(join(testClaudeDir, "plugins", "installed_plugins.json"));
    expect(installed.plugins["apijack@local"]).toBeUndefined();
  });

  test("removes from enabledPlugins in settings.json", async () => {
    await uninstallPlugin({ claudeDir: testClaudeDir });

    const settings = readJson(join(testClaudeDir, "settings.json"));
    expect(settings.enabledPlugins["apijack@local"]).toBeUndefined();
  });

  test("removes plugin cache directory", async () => {
    const cacheDir = join(testClaudeDir, "plugins", "cache", "local", "apijack");
    expect(existsSync(cacheDir)).toBe(true);

    await uninstallPlugin({ claudeDir: testClaudeDir });

    expect(existsSync(cacheDir)).toBe(false);
  });

  test("preserves user data directory", async () => {
    await uninstallPlugin({ claudeDir: testClaudeDir });

    expect(existsSync(testDataDir)).toBe(true);
    expect(existsSync(join(testDataDir, "routines"))).toBe(true);
  });

  test("handles already-uninstalled gracefully", async () => {
    await uninstallPlugin({ claudeDir: testClaudeDir });
    const result = await uninstallPlugin({ claudeDir: testClaudeDir });
    expect(result.success).toBe(true);
  });
});
