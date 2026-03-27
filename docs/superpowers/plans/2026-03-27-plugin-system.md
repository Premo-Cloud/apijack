# Claude Code Plugin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register apijack as a user-level Claude Code plugin with one command, including skills, pre-bundled MCP server, and GitHub-based self-updating.

**Architecture:** The plugin is structured directly in the apijack repo (`.claude-plugin/`, `.mcp.json`, `skills/`, `dist/`). A standalone MCP entry point calls apijack functions directly (no subprocess). A `plugin` CLI command copies these files into `~/.claude/plugins/` and registers them. A build script bundles the MCP server into a single file.

**Tech Stack:** Bun (runtime + bundler), @modelcontextprotocol/sdk, Commander (CLI), Node fs APIs

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/plugin/install.ts` | Plugin install logic — copies files to `~/.claude/plugins/`, updates `installed_plugins.json` and `settings.json` |
| `src/plugin/uninstall.ts` | Plugin uninstall logic — removes plugin registration, preserves user data |
| `src/plugin/register.ts` | Registers `plugin install` and `plugin uninstall` commands on the Commander program |
| `src/plugin/paths.ts` | Shared path constants for plugin cache, settings, and user data directories |
| `src/mcp-server-entry.ts` | Standalone MCP server entry point that imports apijack core directly |
| `.claude-plugin/plugin.json` | Plugin manifest (name, version, description) |
| `.mcp.json` | MCP server config pointing to `dist/mcp-server.bundle.js` |
| `scripts/build-plugin.ts` | Build script that bundles the MCP entry point |
| `tests/plugin/install.test.ts` | Tests for plugin install |
| `tests/plugin/uninstall.test.ts` | Tests for plugin uninstall |
| `tests/plugin/paths.test.ts` | Tests for path resolution |
| `tests/mcp-server-entry.test.ts` | Tests for standalone MCP entry point |

**Modified files:**
| File | Change |
|------|--------|
| `src/cli-builder.ts:28-35` | Add `"plugin"` to `CORE_COMMANDS` and `skipAuthCommands`, register plugin command |
| `package.json:44-48` | Add `"build:plugin"` script, update `prepack` |
| `skills/apijack/SKILL.md` | Add plugin install/uninstall documentation |

---

### Task 1: Path Constants

**Files:**
- Create: `src/plugin/paths.ts`
- Test: `tests/plugin/paths.test.ts`

- [ ] **Step 1: Write failing test for path resolution**

```typescript
// tests/plugin/paths.test.ts
import { describe, test, expect } from "bun:test";
import { getPluginPaths } from "../../src/plugin/paths";
import { homedir } from "os";
import { join } from "path";

describe("getPluginPaths()", () => {
  const paths = getPluginPaths("0.1.0");

  test("claudeDir points to ~/.claude", () => {
    expect(paths.claudeDir).toBe(join(homedir(), ".claude"));
  });

  test("pluginCacheDir includes version", () => {
    expect(paths.pluginCacheDir).toBe(
      join(homedir(), ".claude", "plugins", "cache", "local", "apijack", "0.1.0"),
    );
  });

  test("installedPluginsFile points to installed_plugins.json", () => {
    expect(paths.installedPluginsFile).toBe(
      join(homedir(), ".claude", "plugins", "installed_plugins.json"),
    );
  });

  test("settingsFile points to settings.json", () => {
    expect(paths.settingsFile).toBe(
      join(homedir(), ".claude", "settings.json"),
    );
  });

  test("userDataDir points to ~/.apijack", () => {
    expect(paths.userDataDir).toBe(join(homedir(), ".apijack"));
  });

  test("sourceDir points to project root", () => {
    // sourceDir should be the directory containing package.json
    expect(paths.sourceDir).toContain("apijack");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugin/paths.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement paths module**

```typescript
// src/plugin/paths.ts
import { homedir } from "os";
import { join, resolve } from "path";

export interface PluginPaths {
  claudeDir: string;
  pluginCacheDir: string;
  installedPluginsFile: string;
  settingsFile: string;
  userDataDir: string;
  sourceDir: string;
}

export function getPluginPaths(version: string): PluginPaths {
  const home = homedir();
  const claudeDir = join(home, ".claude");
  const pluginsDir = join(claudeDir, "plugins");

  return {
    claudeDir,
    pluginCacheDir: join(pluginsDir, "cache", "local", "apijack", version),
    installedPluginsFile: join(pluginsDir, "installed_plugins.json"),
    settingsFile: join(claudeDir, "settings.json"),
    userDataDir: join(home, ".apijack"),
    sourceDir: resolve(import.meta.dir, "../.."),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugin/paths.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugin/paths.ts tests/plugin/paths.test.ts
git commit -m "feat(plugin): add path constants for plugin registration"
```

---

### Task 2: Plugin Manifest and MCP Config

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.mcp.json`

- [ ] **Step 1: Create the plugin manifest**

```json
// .claude-plugin/plugin.json
{
  "name": "apijack",
  "description": "Jack into any OpenAPI spec — full CLI with AI-agentic workflow automation",
  "version": "0.1.0",
  "author": {
    "name": "Garret"
  },
  "repository": "https://github.com/garrettmichaelgeorge/apijack",
  "license": "MIT",
  "keywords": ["openapi", "cli", "mcp", "api", "routines"]
}
```

Note: update the repository URL if different.

- [ ] **Step 2: Create the MCP config**

```json
// .mcp.json
{
  "apijack": {
    "type": "stdio",
    "command": "bun",
    "args": ["run", "dist/mcp-server.bundle.js"]
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json .mcp.json
git commit -m "feat(plugin): add plugin manifest and MCP config"
```

---

### Task 3: Standalone MCP Server Entry Point

**Files:**
- Create: `src/mcp-server-entry.ts`
- Test: `tests/mcp-server-entry.test.ts`

The standalone entry point reuses `getToolDefinitions()` from the existing `src/mcp-server.ts` but replaces the subprocess-based handlers with direct function calls. For tools that currently shell out (`run_command`, `run_routine`, `generate`, `config_switch`, `config_list`), the standalone version calls the underlying apijack functions directly. For tools that already use direct calls (`list_commands`, `list_routines`, `get_config`, `get_spec`), the implementation is identical.

The key difference: the existing `createHandlers()` takes a `cliInvocation` and spawns subprocesses. The standalone version doesn't need `cliInvocation` — it imports and calls functions directly. However, `run_command` requires a full dispatcher (command-map + client + auth), which needs a live API connection. For the standalone MCP server, `run_command` and `run_routine` will still use subprocess invocation since they need the consumer's generated client code (which isn't available in the apijack package itself).

The practical approach: the standalone entry point reuses the existing `createHandlers()` and `startMcpServer()` with a configured `cliInvocation` that points to `bun run` + the entry point itself with a `--cli` flag. But simpler: since the MCP server already works well with subprocess invocation and the bundle will include the MCP SDK, the standalone entry point just needs to start the MCP server with the right `cliInvocation` derived from config.

Revised approach: The standalone entry point reads `~/.apijack/config.json` to determine the active environment, then starts the MCP server using the existing `startMcpServer()`. The `cliInvocation` is derived from how the user's CLI is installed. For the plugin context, this means storing the CLI invocation path during `plugin install`.

Simplest correct approach: The standalone entry point starts the MCP server and exposes the tools that work without a consumer CLI (config management, routine listing, command listing, spec inspection). For `run_command` and `run_routine`, it needs to know how to invoke the consumer's CLI. This is stored in `~/.apijack/plugin.json` during install.

**Final approach:** The entry point calls `startMcpServer()` with a `cliInvocation` that is stored during plugin install at `~/.apijack/plugin.json`. This keeps the implementation minimal — one new file that reads config and calls the existing function.

- [ ] **Step 1: Write failing test for the entry point's config reader**

```typescript
// tests/mcp-server-entry.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { loadPluginConfig, type PluginConfig } from "../src/mcp-server-entry";

const testDir = join(homedir(), ".apijack-test-entry");

describe("loadPluginConfig()", () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("reads CLI invocation from plugin config", () => {
    const config: PluginConfig = {
      cliInvocation: ["bun", "run", "/path/to/cli.ts"],
      generatedDir: "/path/to/generated",
    };
    writeFileSync(join(testDir, "plugin.json"), JSON.stringify(config));

    const result = loadPluginConfig(testDir);
    expect(result).not.toBeNull();
    expect(result!.cliInvocation).toEqual(["bun", "run", "/path/to/cli.ts"]);
    expect(result!.generatedDir).toBe("/path/to/generated");
  });

  test("returns null when config file missing", () => {
    const result = loadPluginConfig(join(testDir, "nonexistent"));
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/mcp-server-entry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the standalone entry point**

```typescript
// src/mcp-server-entry.ts
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface PluginConfig {
  cliInvocation: string[];
  generatedDir: string;
}

export function loadPluginConfig(dataDir?: string): PluginConfig | null {
  const dir = dataDir ?? join(homedir(), ".apijack");
  const configPath = join(dir, "plugin.json");
  try {
    if (!existsSync(configPath)) return null;
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as PluginConfig;
  } catch {
    return null;
  }
}

// Entry point — only runs when executed directly
if (import.meta.main) {
  const config = loadPluginConfig();
  if (!config) {
    console.error("apijack plugin not configured. Run your CLI's 'plugin install' command first.");
    console.error("Expected config at: ~/.apijack/plugin.json");
    process.exit(1);
  }

  const { startMcpServer } = await import("./mcp-server");
  await startMcpServer({
    cliName: "apijack",
    cliInvocation: config.cliInvocation,
    generatedDir: config.generatedDir,
    routinesDir: join(homedir(), ".apijack", "routines"),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/mcp-server-entry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server-entry.ts tests/mcp-server-entry.test.ts
git commit -m "feat(plugin): standalone MCP server entry point"
```

---

### Task 4: Build Script and Bundle

**Files:**
- Create: `scripts/build-plugin.ts`
- Modify: `package.json:44-48`

- [ ] **Step 1: Create the build script**

```typescript
// scripts/build-plugin.ts
import { resolve } from "path";

const projectRoot = resolve(import.meta.dir, "..");
const entryPoint = resolve(projectRoot, "src/mcp-server-entry.ts");
const outfile = resolve(projectRoot, "dist/mcp-server.bundle.js");

const result = await Bun.build({
  entrypoints: [entryPoint],
  outdir: resolve(projectRoot, "dist"),
  naming: "mcp-server.bundle.js",
  target: "bun",
  minify: false,
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Built: ${outfile}`);
```

- [ ] **Step 2: Update package.json scripts**

In `package.json`, change the `scripts` section:

```json
"scripts": {
  "test": "bun test",
  "lint": "eslint src/",
  "lint:fix": "eslint src/ --fix",
  "build:plugin": "bun run scripts/build-plugin.ts",
  "prepack": "bun run build:plugin && bun run scripts/prepack-agent-docs.ts"
}
```

- [ ] **Step 3: Run the build to verify it works**

Run: `bun run build:plugin`
Expected: Output `Built: /home/garret/projects/apijack/dist/mcp-server.bundle.js`

- [ ] **Step 4: Verify the bundle exists and is non-empty**

Run: `ls -la dist/mcp-server.bundle.js`
Expected: File exists with non-zero size

- [ ] **Step 5: Add dist/ to .gitignore (the bundle is a build artifact)**

Check if `.gitignore` exists. If so, add `dist/` to it. If not, create it with:

```
dist/
```

Note: The spec says to commit the bundle, but on reflection the build script is committed and CI/prepack can generate it. Committing build artifacts pollutes git history. The `prepack` script ensures the bundle exists before npm publish. For the plugin install command, it will run `build:plugin` if the bundle doesn't exist.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-plugin.ts package.json .gitignore
git commit -m "feat(plugin): add MCP server bundle build script"
```

---

### Task 5: Plugin Install

**Files:**
- Create: `src/plugin/install.ts`
- Test: `tests/plugin/install.test.ts`

- [ ] **Step 1: Write failing test for install logic**

```typescript
// tests/plugin/install.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { installPlugin } from "../../src/plugin/install";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Use a temp directory to avoid touching real ~/.claude
const testRoot = join(tmpdir(), "apijack-plugin-test-" + Date.now());
const testClaudeDir = join(testRoot, ".claude");
const testDataDir = join(testRoot, ".apijack");

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("installPlugin()", () => {
  beforeEach(() => {
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  test("creates plugin cache directory with expected files", async () => {
    const result = await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir: join(import.meta.dir, "../.."),
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    expect(result.success).toBe(true);

    const cacheDir = join(testClaudeDir, "plugins", "cache", "local", "apijack", "0.1.0");
    expect(existsSync(join(cacheDir, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(cacheDir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(cacheDir, "skills", "apijack", "SKILL.md"))).toBe(true);
  });

  test("registers in installed_plugins.json", async () => {
    await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir: join(import.meta.dir, "../.."),
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    const installed = readJson(join(testClaudeDir, "plugins", "installed_plugins.json"));
    expect(installed.plugins["apijack@local"]).toBeDefined();
    expect(installed.plugins["apijack@local"][0].version).toBe("0.1.0");
    expect(installed.plugins["apijack@local"][0].scope).toBe("user");
  });

  test("enables in settings.json", async () => {
    await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir: join(import.meta.dir, "../.."),
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    const settings = readJson(join(testClaudeDir, "settings.json"));
    expect(settings.enabledPlugins["apijack@local"]).toBe(true);
  });

  test("creates user data directory", async () => {
    await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir: join(import.meta.dir, "../.."),
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    expect(existsSync(testDataDir)).toBe(true);
    expect(existsSync(join(testDataDir, "routines"))).toBe(true);
  });

  test("writes plugin.json with cliInvocation to user data dir", async () => {
    await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir: join(import.meta.dir, "../.."),
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    const pluginConfig = readJson(join(testDataDir, "plugin.json"));
    expect(pluginConfig.cliInvocation).toEqual(["bun", "run", "src/cli.ts"]);
    expect(pluginConfig.generatedDir).toBe("src/generated");
  });

  test("preserves existing settings.json fields", async () => {
    // Pre-create settings with existing content
    mkdirSync(testClaudeDir, { recursive: true });
    const settingsPath = join(testClaudeDir, "settings.json");
    Bun.write(settingsPath, JSON.stringify({
      enabledPlugins: { "other-plugin@local": true },
      mcpServers: { existing: { type: "stdio" } },
    }));

    await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir: join(import.meta.dir, "../.."),
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    const settings = readJson(settingsPath);
    expect(settings.enabledPlugins["other-plugin@local"]).toBe(true);
    expect(settings.enabledPlugins["apijack@local"]).toBe(true);
    expect(settings.mcpServers.existing).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugin/install.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement install logic**

```typescript
// src/plugin/install.ts
import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync } from "fs";
import { join, resolve } from "path";

export interface InstallOptions {
  version: string;
  claudeDir: string;
  userDataDir: string;
  sourceDir: string;
  cliInvocation: string[];
  generatedDir: string;
}

export interface InstallResult {
  success: boolean;
  pluginCacheDir: string;
  message: string;
}

export async function installPlugin(opts: InstallOptions): Promise<InstallResult> {
  const {
    version,
    claudeDir,
    userDataDir,
    sourceDir,
    cliInvocation,
    generatedDir,
  } = opts;

  const pluginCacheDir = join(claudeDir, "plugins", "cache", "local", "apijack", version);

  // 1. Copy plugin files to cache
  mkdirSync(join(pluginCacheDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(pluginCacheDir, "skills", "apijack"), { recursive: true });

  // Copy .claude-plugin/plugin.json
  const manifestSrc = join(sourceDir, ".claude-plugin", "plugin.json");
  if (existsSync(manifestSrc)) {
    cpSync(manifestSrc, join(pluginCacheDir, ".claude-plugin", "plugin.json"));
  } else {
    // Generate manifest if not found in source
    writeFileSync(
      join(pluginCacheDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "apijack",
        description: "Jack into any OpenAPI spec — full CLI with AI-agentic workflow automation",
        version,
      }, null, 2),
    );
  }

  // Copy .mcp.json
  const mcpSrc = join(sourceDir, ".mcp.json");
  if (existsSync(mcpSrc)) {
    cpSync(mcpSrc, join(pluginCacheDir, ".mcp.json"));
  }

  // Copy skills
  const skillSrc = join(sourceDir, "skills", "apijack", "SKILL.md");
  if (existsSync(skillSrc)) {
    cpSync(skillSrc, join(pluginCacheDir, "skills", "apijack", "SKILL.md"));
  }

  // Copy dist bundle if it exists
  const bundleSrc = join(sourceDir, "dist", "mcp-server.bundle.js");
  if (existsSync(bundleSrc)) {
    mkdirSync(join(pluginCacheDir, "dist"), { recursive: true });
    cpSync(bundleSrc, join(pluginCacheDir, "dist", "mcp-server.bundle.js"));
  }

  // 2. Register in installed_plugins.json
  const installedPath = join(claudeDir, "plugins", "installed_plugins.json");
  mkdirSync(join(claudeDir, "plugins"), { recursive: true });

  let installed: any = { version: "v2", plugins: {} };
  if (existsSync(installedPath)) {
    try {
      installed = JSON.parse(readFileSync(installedPath, "utf-8"));
    } catch {}
  }

  const now = new Date().toISOString();
  installed.plugins["apijack@local"] = [{
    scope: "user",
    installPath: pluginCacheDir,
    version,
    installedAt: now,
    lastUpdated: now,
    gitCommitSha: "",
  }];

  writeFileSync(installedPath, JSON.stringify(installed, null, 2) + "\n");

  // 3. Enable in settings.json
  const settingsPath = join(claudeDir, "settings.json");
  let settings: any = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {}
  }

  if (!settings.enabledPlugins) settings.enabledPlugins = {};
  settings.enabledPlugins["apijack@local"] = true;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

  // 4. Create user data directory
  mkdirSync(join(userDataDir, "routines"), { recursive: true });

  // 5. Write plugin config for the MCP entry point
  writeFileSync(
    join(userDataDir, "plugin.json"),
    JSON.stringify({ cliInvocation, generatedDir }, null, 2) + "\n",
  );

  return {
    success: true,
    pluginCacheDir,
    message: `apijack plugin v${version} installed successfully`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugin/install.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugin/install.ts tests/plugin/install.test.ts
git commit -m "feat(plugin): implement plugin install logic"
```

---

### Task 6: Plugin Uninstall

**Files:**
- Create: `src/plugin/uninstall.ts`
- Test: `tests/plugin/uninstall.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/plugin/uninstall.test.ts
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
    // Install first so we have something to uninstall
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
    // Second uninstall should not throw
    const result = await uninstallPlugin({ claudeDir: testClaudeDir });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/plugin/uninstall.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement uninstall logic**

```typescript
// src/plugin/uninstall.ts
import { existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

export interface UninstallOptions {
  claudeDir: string;
}

export interface UninstallResult {
  success: boolean;
  message: string;
}

export async function uninstallPlugin(opts: UninstallOptions): Promise<UninstallResult> {
  const { claudeDir } = opts;

  // 1. Remove from installed_plugins.json
  const installedPath = join(claudeDir, "plugins", "installed_plugins.json");
  if (existsSync(installedPath)) {
    try {
      const installed = JSON.parse(readFileSync(installedPath, "utf-8"));
      delete installed.plugins["apijack@local"];
      writeFileSync(installedPath, JSON.stringify(installed, null, 2) + "\n");
    } catch {}
  }

  // 2. Remove from settings.json enabledPlugins
  const settingsPath = join(claudeDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (settings.enabledPlugins) {
        delete settings.enabledPlugins["apijack@local"];
      }
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    } catch {}
  }

  // 3. Remove plugin cache directory
  const cacheDir = join(claudeDir, "plugins", "cache", "local", "apijack");
  if (existsSync(cacheDir)) {
    rmSync(cacheDir, { recursive: true, force: true });
  }

  // NOTE: User data at ~/.apijack/ is intentionally preserved

  return {
    success: true,
    message: "apijack plugin uninstalled. User data preserved at ~/.apijack/",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/plugin/uninstall.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plugin/uninstall.ts tests/plugin/uninstall.test.ts
git commit -m "feat(plugin): implement plugin uninstall logic"
```

---

### Task 7: Register Plugin Command in CLI

**Files:**
- Create: `src/plugin/register.ts`
- Modify: `src/cli-builder.ts:28-35` (add to CORE_COMMANDS and skipAuthCommands)
- Modify: `src/cli-builder.ts:355-381` (register plugin command after mcp command)

- [ ] **Step 1: Create the plugin command registration module**

```typescript
// src/plugin/register.ts
import { Command } from "commander";
import { resolve } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { installPlugin } from "./install";
import { uninstallPlugin } from "./uninstall";
import { getPluginPaths } from "./paths";

export function registerPluginCommand(
  program: Command,
  cliName: string,
  version: string,
): void {
  const plugin = program
    .command("plugin")
    .description("Manage Claude Code plugin registration");

  plugin
    .command("install")
    .description("Register as a Claude Code plugin")
    .option("--cli-invocation <args...>", "How to invoke this CLI (e.g., bun run src/cli.ts)")
    .option("--generated-dir <dir>", "Path to generated files directory", "src/generated")
    .action(async (opts: { cliInvocation?: string[]; generatedDir?: string }) => {
      const paths = getPluginPaths(version);

      // Determine CLI invocation — use provided value or derive from current process
      const cliInvocation = opts.cliInvocation ?? process.argv.slice(0, 2);

      // Build the bundle if it doesn't exist
      const bundlePath = resolve(paths.sourceDir, "dist", "mcp-server.bundle.js");
      if (!existsSync(bundlePath)) {
        console.log("Building MCP server bundle...");
        const buildScript = resolve(paths.sourceDir, "scripts", "build-plugin.ts");
        const proc = Bun.spawn(["bun", "run", buildScript], {
          stdout: "inherit",
          stderr: "inherit",
        });
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          console.error("Bundle build failed.");
          process.exit(1);
        }
      }

      const result = await installPlugin({
        version,
        claudeDir: paths.claudeDir,
        userDataDir: paths.userDataDir,
        sourceDir: paths.sourceDir,
        cliInvocation,
        generatedDir: opts.generatedDir ?? "src/generated",
      });

      if (result.success) {
        console.log(result.message);
        console.log(`\n  Plugin cache:  ${result.pluginCacheDir}`);
        console.log(`  User data:     ${paths.userDataDir}`);
        console.log(`  CLI invocation: ${cliInvocation.join(" ")}`);
        console.log(`\nRestart Claude Code to activate the plugin.`);
      }
    });

  plugin
    .command("uninstall")
    .description("Remove Claude Code plugin registration")
    .action(async () => {
      const paths = getPluginPaths(version);
      const result = await uninstallPlugin({ claudeDir: paths.claudeDir });
      console.log(result.message);
    });
}
```

- [ ] **Step 2: Add "plugin" to CORE_COMMANDS in cli-builder.ts**

In `src/cli-builder.ts`, modify the `CORE_COMMANDS` set at line 28:

```typescript
const CORE_COMMANDS = new Set([
  "setup",
  "login",
  "config",
  "generate",
  "routine",
  "mcp",
  "plugin",
]);
```

- [ ] **Step 3: Add "plugin" to skipAuthCommands in cli-builder.ts**

In `src/cli-builder.ts`, modify the `skipAuthCommands` set at line 387:

```typescript
const skipAuthCommands = new Set([
  "login",
  "setup",
  "config",
  "routine",
  "generate",
  "mcp",
  "plugin",
]);
```

- [ ] **Step 4: Register the plugin command in cli-builder.ts**

In `src/cli-builder.ts`, add the import at the top (after line 20):

```typescript
import { registerPluginCommand } from "./plugin/register";
```

Then after the `mcp` command registration (after line 381, before the auth resolution block), add:

```typescript
      // plugin
      registerPluginCommand(program, cliName, options.version);
```

- [ ] **Step 5: Run existing tests to ensure nothing is broken**

Run: `bun test`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/plugin/register.ts src/cli-builder.ts
git commit -m "feat(plugin): register plugin install/uninstall commands in CLI"
```

---

### Task 8: Update SKILL.md for Plugin Context

**Files:**
- Modify: `skills/apijack/SKILL.md`

- [ ] **Step 1: Update the skill file to include plugin documentation**

Add a section to `skills/apijack/SKILL.md` after the MCP Server section (after line 148):

```markdown
## Plugin Management

Register apijack as a Claude Code plugin for global availability:

```bash
<cli> plugin install                     # Register as Claude Code plugin
<cli> plugin install --cli-invocation bun run src/cli.ts  # Custom CLI path
<cli> plugin uninstall                   # Remove plugin registration
```

After installing, restart Claude Code. The MCP server and skills will be available globally.

User data (environments, routines) is stored at `~/.apijack/` and survives plugin updates/reinstalls.
```

- [ ] **Step 2: Commit**

```bash
git add skills/apijack/SKILL.md
git commit -m "docs: add plugin commands to skill definition"
```

---

### Task 9: Integration Test

**Files:**
- Create: `tests/plugin/integration.test.ts`

This test verifies the full install → verify → uninstall → verify roundtrip.

- [ ] **Step 1: Write the integration test**

```typescript
// tests/plugin/integration.test.ts
import { describe, test, expect, afterEach } from "bun:test";
import { installPlugin } from "../../src/plugin/install";
import { uninstallPlugin } from "../../src/plugin/uninstall";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testRoot = join(tmpdir(), "apijack-integration-" + Date.now());
const testClaudeDir = join(testRoot, ".claude");
const testDataDir = join(testRoot, ".apijack");
const sourceDir = join(import.meta.dir, "../..");

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("plugin install → uninstall roundtrip", () => {
  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  test("full lifecycle: install, verify, uninstall, verify preservation", async () => {
    // Install
    const installResult = await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir,
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });
    expect(installResult.success).toBe(true);

    // Verify all files are in place
    const cacheDir = installResult.pluginCacheDir;
    expect(existsSync(join(cacheDir, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(cacheDir, "skills", "apijack", "SKILL.md"))).toBe(true);

    // Verify registrations
    const installed = readJson(join(testClaudeDir, "plugins", "installed_plugins.json"));
    expect(installed.plugins["apijack@local"]).toHaveLength(1);

    const settings = readJson(join(testClaudeDir, "settings.json"));
    expect(settings.enabledPlugins["apijack@local"]).toBe(true);

    // Verify user data
    expect(existsSync(join(testDataDir, "routines"))).toBe(true);
    expect(existsSync(join(testDataDir, "plugin.json"))).toBe(true);

    // Uninstall
    const uninstallResult = await uninstallPlugin({ claudeDir: testClaudeDir });
    expect(uninstallResult.success).toBe(true);

    // Verify plugin removed
    expect(existsSync(join(testClaudeDir, "plugins", "cache", "local", "apijack"))).toBe(false);

    const installedAfter = readJson(join(testClaudeDir, "plugins", "installed_plugins.json"));
    expect(installedAfter.plugins["apijack@local"]).toBeUndefined();

    const settingsAfter = readJson(join(testClaudeDir, "settings.json"));
    expect(settingsAfter.enabledPlugins["apijack@local"]).toBeUndefined();

    // Verify user data preserved
    expect(existsSync(testDataDir)).toBe(true);
    expect(existsSync(join(testDataDir, "routines"))).toBe(true);
    expect(existsSync(join(testDataDir, "plugin.json"))).toBe(true);
  });

  test("reinstall after uninstall works cleanly", async () => {
    // First install
    await installPlugin({
      version: "0.1.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir,
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    // Uninstall
    await uninstallPlugin({ claudeDir: testClaudeDir });

    // Reinstall with new version
    const result = await installPlugin({
      version: "0.2.0",
      claudeDir: testClaudeDir,
      userDataDir: testDataDir,
      sourceDir,
      cliInvocation: ["bun", "run", "src/cli.ts"],
      generatedDir: "src/generated",
    });

    expect(result.success).toBe(true);
    expect(result.pluginCacheDir).toContain("0.2.0");

    const installed = readJson(join(testClaudeDir, "plugins", "installed_plugins.json"));
    expect(installed.plugins["apijack@local"][0].version).toBe("0.2.0");
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `bun test tests/plugin/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/plugin/integration.test.ts
git commit -m "test(plugin): add install/uninstall integration test"
```

---

### Task 10: Export Plugin Functions from Index

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add plugin exports**

Add to the end of `src/index.ts`:

```typescript
export { installPlugin } from "./plugin/install";
export type { InstallOptions, InstallResult } from "./plugin/install";
export { uninstallPlugin } from "./plugin/uninstall";
export type { UninstallOptions, UninstallResult } from "./plugin/uninstall";
export { getPluginPaths } from "./plugin/paths";
export type { PluginPaths } from "./plugin/paths";
```

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(plugin): export plugin functions from package index"
```

---

### Task 11: Final Verification

- [ ] **Step 1: Run the full test suite**

Run: `bun test`
Expected: All tests pass, no regressions

- [ ] **Step 2: Run the linter**

Run: `bun run lint`
Expected: No new lint errors

- [ ] **Step 3: Verify the build**

Run: `bun run build:plugin`
Expected: Bundle builds successfully at `dist/mcp-server.bundle.js`

- [ ] **Step 4: Dry-run the plugin manifest**

Run: `cat .claude-plugin/plugin.json`
Expected: Valid JSON with correct name, version, description

- [ ] **Step 5: Verify the MCP config**

Run: `cat .mcp.json`
Expected: Valid JSON pointing to `dist/mcp-server.bundle.js`
