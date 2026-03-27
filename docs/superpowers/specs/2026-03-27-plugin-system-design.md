# Claude Code Plugin System Design

**Date:** 2026-03-27
**Status:** Approved

## Overview

Add a plugin registration system to apijack so that a single command installs it as a user-level Claude Code plugin — with skills, MCP server, and GitHub-based self-updating. User data (configs, routines, environments) lives outside the plugin cache so it survives updates and reinstalls.

## Goals

1. One-command setup: `apijack plugin install` registers everything in `~/.claude/`
2. Self-updating via GitHub marketplace (Claude Code tracks git SHAs)
3. Pre-bundled MCP server — no runtime dependency resolution needed
4. User data isolated from plugin lifecycle
5. Future-proof for project-level awareness (Option C)

## Non-Goals (for now)

- Project-level plugin scoping (future work — see Future C Hook section)
- Publishing to the official Claude Code marketplace (start with local/GitHub source)
- CLI commands exposed directly as shell commands (MCP only for now)

## Architecture

### In-Repo Plugin Structure

These files are committed to the apijack repo and are what Claude Code clones/caches:

```
.claude-plugin/
└── plugin.json              # Plugin manifest
.mcp.json                    # MCP server configuration
skills/
└── apijack/
    └── SKILL.md             # Claude Code skill (already exists)
dist/
└── mcp-server.bundle.js     # Pre-bundled standalone MCP server
```

### Plugin Manifest (`.claude-plugin/plugin.json`)

```json
{
  "name": "apijack",
  "description": "Jack into any OpenAPI spec — full CLI with AI-agentic workflow automation",
  "version": "<from package.json>",
  "author": {
    "name": "Garret"
  },
  "repository": "https://github.com/<owner>/apijack",
  "license": "MIT",
  "keywords": ["openapi", "cli", "mcp", "api", "routines"]
}
```

### MCP Configuration (`.mcp.json`)

```json
{
  "apijack": {
    "type": "stdio",
    "command": "bun",
    "args": ["run", "dist/mcp-server.bundle.js"]
  }
}
```

The path resolves relative to the plugin install directory. Claude Code expands this when loading the plugin.

## Components

### 1. Standalone MCP Server Entry Point

**New file:** `src/mcp-server-entry.ts`

A standalone entry point that imports apijack core functionality directly (not via subprocess). This is what gets bundled.

Responsibilities:
- Starts an MCP server on stdio using `@modelcontextprotocol/sdk`
- Reads config from `~/.apijack/config.json`
- Loads routines from `~/.apijack/routines/`
- Exposes the same 9 tools as the current `mcp` command:
  - `run_command` — Execute a CLI command
  - `run_routine` — Execute a routine workflow
  - `generate` — Regenerate CLI from OpenAPI spec
  - `config_switch` — Switch active environment
  - `config_list` — List environments
  - `list_commands` — List available CLI commands
  - `list_routines` — List available routines
  - `get_config` — Get active environment config
  - `get_spec` — Get API type summary

Key difference from current `src/mcp-server.ts`: this entry point calls apijack functions directly instead of spawning a subprocess. The current MCP server uses `Bun.spawn()` with `cliInvocation` — the standalone version imports and calls the underlying functions.

### 2. Bundle Build Script

**New script in `package.json`:** `"build:plugin": "bun build src/mcp-server-entry.ts --target=bun --outfile=dist/mcp-server.bundle.js"`

This produces a single file with all dependencies (commander, js-yaml, cli-table3, @modelcontextprotocol/sdk) inlined. The bundle is committed to the repo so the plugin works immediately after clone — no `bun install` needed in the plugin cache.

The `prepack` script should be updated to also run the plugin build:
```json
"prepack": "bun run build:plugin && bun run scripts/prepack-agent-docs.ts"
```

### 3. Plugin Install Command

**New built-in command:** `apijack plugin install`

Registration flow:
1. Determine the plugin source path (the apijack repo/package root)
2. Copy plugin structure into `~/.claude/plugins/cache/local/apijack/{version}/`:
   - `.claude-plugin/plugin.json`
   - `.mcp.json`
   - `skills/apijack/SKILL.md`
   - `dist/mcp-server.bundle.js`
3. Register in `~/.claude/plugins/installed_plugins.json`:
   ```json
   {
     "apijack@local": [{
       "scope": "user",
       "installPath": "~/.claude/plugins/cache/local/apijack/{version}",
       "version": "{version}",
       "installedAt": "{ISO timestamp}",
       "lastUpdated": "{ISO timestamp}",
       "gitCommitSha": ""
     }]
   }
   ```
4. Enable in `~/.claude/settings.json`:
   ```json
   {
     "enabledPlugins": {
       "apijack@local": true
     }
   }
   ```
5. Create `~/.apijack/` directory structure if it doesn't exist:
   ```
   ~/.apijack/
   ├── config.json
   └── routines/
   ```
6. Print confirmation: what was installed, where data lives, how to update

### 4. Plugin Uninstall Command

**New built-in command:** `apijack plugin uninstall`

1. Remove from `~/.claude/plugins/installed_plugins.json`
2. Remove from `enabledPlugins` in `~/.claude/settings.json`
3. Delete `~/.claude/plugins/cache/local/apijack/`
4. **Do NOT delete** `~/.apijack/` — user data survives uninstall
5. Print confirmation noting that user data was preserved

### 5. Self-Updating via GitHub

For GitHub-based self-updating (the preferred path once apijack is published):

Register a marketplace entry in `~/.claude/plugins/known_marketplaces.json`:
```json
{
  "apijack": {
    "source": {
      "source": "github",
      "repo": "<owner>/apijack"
    },
    "installLocation": "~/.claude/plugins/marketplaces/apijack",
    "lastUpdated": "{ISO timestamp}"
  }
}
```

Then the plugin registration in `installed_plugins.json` uses `apijack@apijack` (or the marketplace name) instead of `apijack@local`, and includes the `gitCommitSha`. Claude Code's `/plugin update` pulls the latest commit, which includes an updated `dist/mcp-server.bundle.js`.

The `plugin install` command should support a `--source github` flag to use this path, defaulting to `local` for development.

## User Data Layout

```
~/.apijack/
├── config.json          # Multi-environment configuration
│                        #   { active: "env1", environments: { ... } }
├── routines/            # User-created routine YAML files
└── cache/               # (future) Per-project generated artifacts
```

This is the same layout the existing config system uses (via `~/.{cliName}/`), just hardcoded to `apijack` for the plugin context.

## File Changes Summary

| File | Change |
|------|--------|
| `src/mcp-server-entry.ts` | **New** — Standalone MCP entry point |
| `src/plugin/install.ts` | **New** — Plugin install logic |
| `src/plugin/uninstall.ts` | **New** — Plugin uninstall logic |
| `src/plugin/index.ts` | **New** — Plugin command registration |
| `.claude-plugin/plugin.json` | **New** — Plugin manifest |
| `.mcp.json` | **New** — MCP server config for plugin |
| `dist/mcp-server.bundle.js` | **New** — Pre-built bundle (generated, committed) |
| `skills/apijack/SKILL.md` | **Update** — Refine for plugin context |
| `src/cli-builder.ts` | **Update** — Register `plugin` command |
| `package.json` | **Update** — Add `build:plugin` script |
| `src/mcp-server.ts` | **Unchanged** — Existing subprocess-based MCP server stays |

## Future C Hook: Project-Level Awareness

Not implemented now, but the design accommodates it:

- **Project detection**: MCP server checks for `.apijack.json` in the working directory (passed via MCP context or environment variable)
- **Config layering**: Project config overrides user config — `resolveAuth()` checks project first, falls back to `~/.apijack/`
- **Scoped tools**: When project config exists, `list_commands` and `list_routines` filter to that project's generated commands and routines
- **Generated artifacts**: `generate` drops project-specific types/client/commands into the project, and the MCP server uses those when present
- **Skill enrichment**: Project-level skills (generated by `generate --agent-docs`) add API-specific context on top of the base apijack skill

The key change for C is adding a `projectRoot` parameter to the MCP server's config resolution, which cascades through the existing functions. No structural changes needed — just an additional lookup layer.

## Testing Strategy

- Unit tests for plugin install/uninstall (mock filesystem operations)
- Integration test: install plugin, verify files exist in expected locations, verify `installed_plugins.json` and `settings.json` updated correctly
- Bundle test: verify `dist/mcp-server.bundle.js` starts and responds to MCP tool calls
- Roundtrip test: install → uninstall → verify clean removal, verify user data preserved
