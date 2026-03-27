# AI Agent Integration Design

**Date:** 2026-03-27
**Status:** Approved

## Overview

Add AI agent integration to apijack so any AI coding agent can discover, understand, and operate CLIs built with the framework. Three layers: package-level convention files, project-level generated docs, and an MCP server.

## Layer 1: Package-Level Convention Files

Static files that ship with `bun add apijack`. Describe the framework generically.

### Files shipped in the npm package

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Claude Code / Claude-specific guidance |
| `AGENTS.md` | Generic agent guidance (Copilot, Aider, Windsurf, etc.) |
| `GEMINI.md` | Gemini CLI guidance |
| `skills/apijack/SKILL.md` | Claude Code skill (standard `skills/<name>/SKILL.md` convention) |

### Content (all generated from a single template)

- What apijack is and how it works
- How to use `createCli()` to build a CLI
- How to run `generate` to pull an OpenAPI spec
- How routines work (YAML format, variables, conditions, forEach, assertions)
- How to use `-o routine-step` to discover command flags
- Auth strategy patterns (Basic, Bearer, API Key, Custom)
- Available built-in commands (setup, config, generate, routine)
- Link to MCP server for richer integration

### Agent-specific sections

- **CLAUDE.md** — references CLAUDE.md convention, Claude Code skills, slash commands
- **GEMINI.md** — references GEMINI.md convention, `activate_skill`
- **AGENTS.md** — agent-agnostic, just CLI usage patterns

### Generation

A single template at `src/agent-docs/template.md` with light conditionals (e.g. `{{#if claude}}`) rendered by `src/agent-docs/render.ts`. A `prepack` script generates the files before npm publish. The generated files are committed to git so they're visible in the repo.

The `scripts/` directory is new (does not exist yet). Add a `"prepack": "bun run scripts/prepack-agent-docs.ts"` entry to `package.json` scripts.

### Claude Code Skill (`skills/apijack/SKILL.md`)

Standard frontmatter format:

```markdown
---
name: apijack
description: Use when working with an apijack-powered CLI — running commands, building routines, generating from OpenAPI specs
---

[skill content — same as CLAUDE.md but focused on actionable instructions]
```

## Layer 2: Project-Level Generated Docs

Emitted by `mycli generate` alongside the 4 codegen files. Tailored to the specific CLI with actual commands, routines, and config.

### Generated files

| File | Location | Purpose |
|------|----------|---------|
| `CLAUDE.md` | Project root | Claude-specific guidance with actual command inventory |
| `AGENTS.md` | Project root | Generic agent guidance with actual command inventory |
| `GEMINI.md` | Project root | Gemini guidance with actual command inventory |
| `SKILL.md` | `.claude/skills/<cli-name>/SKILL.md` | Project-specific Claude Code skill |
| `apijack.md` | `.cursor/rules/apijack.md` | Cursor rules file |

### Generated content includes

- CLI name, description, version
- Full command inventory (from generated command-map) with descriptions
- Available routines (from routines dir) with names and descriptions
- Active environment info (URL, user — no password)
- Auth strategy in use
- Example commands for common operations
- Routine YAML format with project-specific examples (using actual command names)
- How to use `-o routine-step` to build routines interactively

### Flags on `generate`

- **Default (`append`):** generates agent docs using marker comments, preserving any hand-written content in existing files
- **`--no-agent-docs`:** skip agent doc generation entirely
- **`--agent-docs=overwrite`:** fully replace agent doc files (use when you want a clean regeneration)

### Append mode

When `--agent-docs=append` is used, generated content lives between marker comments:

```markdown
<!-- apijack:generated:start -->
... generated command inventory, routines, etc ...
<!-- apijack:generated:end -->
```

Hand-written content outside these markers is preserved. Only the content between markers is updated. If the markers don't exist yet, they're appended to the end of the file.

### Template system

Same `src/agent-docs/render.ts` handles both package-level and project-level generation. For project-level, it receives additional context:

```ts
interface ProjectContext {
  cliName: string;
  description: string;
  version: string;
  /** Built by reading the generated command-map.ts — transform Record<string, CommandMapping> to this array */
  commands: Array<{ path: string; operationId: string; description?: string; hasBody: boolean }>;
  /** Built by reading ~/.<cliName>/routines/ via listRoutines() — empty array if dir doesn't exist */
  routines: Array<{ name: string; description?: string }>;
  activeEnv?: { url: string; user: string };
}
```

## Layer 3: MCP Server

Built into apijack. Started with `mycli mcp`.

### All tools (no resources — broader client compatibility)

**Action tools:**

| Tool | Input | Description |
|------|-------|-------------|
| `run_command` | `{ command: string, args?: Record<string, string> }` | Execute any CLI command with args |
| `run_routine` | `{ name: string, set?: Record<string, string> }` | Execute a routine with optional overrides |
| `generate` | `{}` | Regenerate CLI from the active environment's OpenAPI spec |
| `config_switch` | `{ name: string }` | Switch active environment |
| `config_list` | `{}` | List configured environments |

**Read-only tools:**

| Tool | Input | Description |
|------|-------|-------------|
| `list_commands` | `{ filter?: string }` | List available commands (optionally filtered by prefix) |
| `list_routines` | `{}` | List available routines with descriptions |
| `get_config` | `{}` | Get active environment info (URL, user — no password) |
| `get_spec` | `{}` | Get OpenAPI spec summary (endpoint count, schema count, tags) |

### Implementation

Single file `src/mcp-server.ts` using `@modelcontextprotocol/sdk`.

- Action tools shell out to the CLI via `Bun.spawn`. The invocation is reconstructed from `process.argv[0]` and `process.argv[1]` (e.g. `bun run src/cli.ts` or the compiled binary path). This works whether the consumer runs via `bun run src/cli.ts` during development or a compiled binary in production.
- Read-only tools read from disk: command-map file, routines directory, config file
- The CLI name is passed to `startMcpServer()` from the `createCli()` options

### Consumer wiring

The `createCli()` function automatically registers the `mcp` subcommand when the MCP SDK is available:

```ts
program
  .command("mcp")
  .description("Start MCP server for AI agent integration")
  .action(async () => {
    const { startMcpServer } = await import("./mcp-server");
    await startMcpServer({ cliName: options.name, ... });
  });
```

### MCP config registration

Consumer adds to their MCP config (e.g. `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "myapi": {
      "command": "mycli",
      "args": ["mcp"]
    }
  }
}
```

## New Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK, added as an **`optionalDependency`** (not a hard dependency). The MCP server uses a dynamic `await import("@modelcontextprotocol/sdk")` and catches the import failure gracefully — if the SDK is not installed, the `mcp` subcommand prints a message telling the user to install it. This keeps the core package lean for consumers who don't need MCP.

## Changes to Existing Code

### `src/cli-builder.ts`

Agent doc generation happens in `cli-builder.ts` (NOT in `src/codegen/index.ts`), because the CLI context (name, description, version, routines dir) lives here, not in the codegen module. The flow:

1. The `generate` command calls `fetchAndGenerate()` as before (writes 4 codegen files)
2. After `fetchAndGenerate()` returns, `cli-builder.ts` reads the generated `command-map.ts` to build `ProjectContext.commands`
3. It reads the routines directory (`~/.<name>/routines/`) to build `ProjectContext.routines` — if the dir doesn't exist or is empty, routines is `[]` (the generated docs omit the routines section)
4. It calls `renderProjectDocs(projectContext, opts)` from `src/agent-docs/render.ts`

Additional changes:
- Register the `mcp` subcommand
- Add `--no-agent-docs` and `--agent-docs=append` options to the `generate` command

### Default behavior for existing projects

On first `generate` run, if `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` already exist at the project root, they are **not overwritten** unless the user explicitly passes `--agent-docs=overwrite`. Default behavior is `append` — generated content is placed between marker comments, preserving any existing content. This is safe for projects that already have their own `CLAUDE.md`.

## New Files

| File | Purpose |
|------|---------|
| `src/agent-docs/template.md` | Single source template for all convention files |
| `src/agent-docs/render.ts` | Template renderer → CLAUDE.md / AGENTS.md / GEMINI.md / skills / cursor rules |
| `src/agent-docs/project-template.md` | Template for project-level generated docs |
| `src/mcp-server.ts` | MCP server implementation |
| `scripts/prepack-agent-docs.ts` | Prepack script to generate package-level docs |
| `CLAUDE.md` | Generated (committed) |
| `AGENTS.md` | Generated (committed) |
| `GEMINI.md` | Generated (committed) |
| `skills/apijack/SKILL.md` | Generated (committed) |

## Project Structure Addition

```
apijack/
  src/
    agent-docs/
      template.md           # Single source for package-level docs
      project-template.md   # Template for project-level generated docs
      render.ts             # Renders templates → convention files
    mcp-server.ts           # MCP server
  scripts/
    prepack-agent-docs.ts   # Prepack hook
  skills/
    apijack/
      SKILL.md              # Generic Claude Code skill (generated, committed)
  CLAUDE.md                 # Generated, committed
  AGENTS.md                 # Generated, committed
  GEMINI.md                 # Generated, committed
```

## Testing

- Unit tests for `render.ts`: template rendering with different agent targets, project context injection, append mode marker handling
- Unit tests for MCP server: tool registration, command execution, read-only tool responses
- Integration test: generate with agent docs, verify files created with correct content
- Integration test: generate with `--no-agent-docs`, verify no agent files created
- Integration test: generate with `--agent-docs=append`, verify hand-written content preserved
