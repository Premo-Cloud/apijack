# apijack

apijack is a framework for generating full-featured CLIs from OpenAPI specs. It produces typed API clients, Commander-based command trees, and supports AI-agentic workflow automation via routines.

## Quick Start

```ts
import { createCli } from "@apijack/core";

const cli = createCli({
  name: "mycli",
  description: "My API CLI",
  version: "1.0.0",
  specPath: "/v3/api-docs",
  auth: new BasicAuthStrategy(),
});

await cli.run();
```

## Code Generation

Run `<cli> generate` against a live API to produce:

- `src/generated/types.ts` -- TypeScript interfaces from OpenAPI component schemas
- `src/generated/client.ts` -- API client class with one method per operationId
- `src/generated/commands.ts` -- Commander subcommands grouped by OpenAPI tags
- `src/generated/command-map.ts` -- Lookup table mapping command paths to metadata

Generated files are committed to git so the CLI works without a live API.

## Routine System

Routines are YAML-based workflow definitions stored in `~/.<cli>/routines/`. They chain CLI commands with variables, conditionals, loops, assertions, and sub-routines.

### Routine YAML Format

```yaml
name: my-routine
description: Example workflow
variables:
  project_name: "default-value"
steps:
  - name: create-resource
    command: resources create
    args:
      --name: "$project_name"
    output: created

  - name: verify-resource
    command: resources get
    args:
      --id: "$created.id"
    assert:
      - path: "$.name"
        equals: "$project_name"

  - name: process-items
    forEach: "$created.items"
    steps:
      - name: handle-item
        command: items process
        args:
          --id: "$item.id"

  - name: conditional-step
    command: resources finalize
    args:
      --id: "$created.id"
    condition: "$created.status == 'ready'"
```

### Key Routine Features

- **Variables**: Define defaults in `variables:`, override at runtime with `--set key=value`
- **Output capture**: `output: alias` stores step result, referenced as `$alias.field`
- **Conditions**: `condition:` expressions skip steps when false
- **forEach loops**: Iterate over arrays from previous step output
- **Assertions**: `assert:` validates response fields with `equals`, `contains`, `matches`
- **Sub-routines**: `routine:` field runs another routine inline
- **Plugins**: Top-level `plugins:` block passes per-routine configuration to registered apijack plugins (e.g., `plugins: { faker: { seed: 42 } }`). See `<cli> plugins list` for what's installed.

### Built-in resolver functions

Usable anywhere a routine value is resolved (args, conditions, variables):

- `$_env(VAR)` / `$_env(VAR, default)` — read an env var (with `.env` auto-loaded at the project root)
- `$_find($array, field, value)` — first matching element, or `undefined`
- `$_contains($array, field, value)` — `"true"` / `"false"`, handy in conditions
- `$_uuid`, `$_random_int(min, max)`, `$_random_from($array)`, `$_random_distinct_from($array, $exclude)`, `$_random_hex_color`

### Routine Commands

```bash
<cli> routine list              # List available routines
<cli> routine list --tree       # Show full tree structure
<cli> routine run <name>        # Execute a routine
<cli> routine run <name> --set key=value  # Override variables
<cli> routine run <name> --dry-run        # Preview without executing
<cli> routine run <name> --json           # Emit RoutineResult as JSON to stdout
<cli> routine validate <name>   # Validate YAML structure
<cli> routine test <name>       # Run spec (test) file
<cli> routine init              # Install built-in routines
<cli> plugins list              # List registered apijack plugins
<cli> plugins check             # Validate plugins (namespace, collisions, peer versions)
```

### Programmatic Routine Invocation

Two surfaces, one engine:

- **`cli.runRoutine(name, opts?)`** — method on the `Cli` returned by `createCli`. Use from a project that already has a `bin/<cli>.ts`.
- **`runRoutine(name, opts?)`** — top-level export from `@apijack/core` for projects on the shared `apijack` binary (no bin file).

Both resolve with a `RoutineResult` (status, output, steps, durationMs, ...) on success and on step failure. Engine errors (routine not found, YAML invalid, no active env config) throw. Useful for Playwright/Vitest fixtures that seed via routines.

## Plugin System

apijack supports pre-built plugins as standalone npm packages. Plugins register resolver functions under their own namespace (e.g., `@apijack/plugin-faker` exposes `$_faker(...)` for routines).

### Installing a plugin

```ts
import { createCli } from "@apijack/core";
import faker from "@apijack/plugin-faker";

const cli = createCli({ name: "mycli", /* ... */ });
cli.use(faker());              // zero-config
cli.use(faker({ seed: 42 }));  // with default opts
await cli.run();
```

### Auto-registration via `.apijack/plugins.ts`

Projects that consume the shared `apijack` binary (no custom `bin/<cli>.ts`) can register plugins by exporting an array from `.apijack/plugins.ts`:

```ts
// .apijack/plugins.ts
import faker from '@apijack/plugin-faker';
import type { ApijackPlugin } from '@apijack/core';

const plugins: ApijackPlugin[] = [
    faker({ seed: 42 }),
];

export default plugins;
```

The binary calls `cli.use(plugin)` for each entry before registering project commands, dispatchers, and resolvers — so a project resolver can wrap a plugin-provided function.

### Per-routine plugin configuration

```yaml
name: seeded-user-gen
plugins:
  faker:
    seed: 42
steps:
  - name: make-user
    command: users create
    args:
      --name: "$_faker(person.fullName)"
```

Each routine invocation receives a fresh plugin state closure — routines are isolated from each other. Sub-routines without their own `plugins:` block inherit the parent's closures.

### Plugin diagnostics

```bash
<cli> plugins list     # show installed plugins with version and status
<cli> plugins check    # validate namespace, collision, and peer-version rules (exits non-zero on issue)
```

## Command Discovery with `-o routine-step`

Append `-o routine-step` to any CLI command to output its YAML step definition instead of executing it. This is the primary way to discover command signatures for building routines.

```bash
<cli> resources create --name test -o routine-step
```

Outputs:

```yaml
- name: create
  command: resources create
  args:
    --name: "test"
    # --description: "" # optional -- Resource description
    # --tags: "" # optional -- Comma-separated tags
```

## Authentication Strategies

apijack supports pluggable authentication:

- **BasicAuthStrategy** -- HTTP Basic auth (username + password)
- **BearerTokenStrategy** -- Bearer token in Authorization header
- **ApiKeyStrategy** -- API key in a custom header
- **SessionAuthStrategy** -- cookie / CSRF flows; supports an `onChallenge` hook for mid-session MFA or renewal prompts
- **Custom** -- Implement the `AuthStrategy` interface for OAuth or other flows

Generated OpenAPI commands resolve the session automatically. Consumer-registered custom commands and dispatchers opt in — see Project Extensions below.

### Stale-session refresh and retry (opt-in)

`SessionAuthStrategy`'s cached cookies can go stale on the server side (idle timeout) without the client knowing — the next call ships the dead cookie and the server returns 401 (or 403 in some Spring configs). To recover transparently, opt in by setting `refreshOn` on the session config:

```ts
new SessionAuthStrategy(new BasicAuthStrategy(), {
  session: { endpoint: '/session' },
  cookies: { extract: ['SESSION'], applyTo: ['POST', 'PUT', 'DELETE'] },
  refreshOn: [401],   // or [401, 403]
});
```

When the generated client receives a status in `refreshOn`, it calls the wired refresh callback — which invalidates the cached session and re-bootstraps `/session` — then retries the original request once. Capped at one retry. Strategies that don't use `/session` are unaffected (the field is ignored).

### Dropping base-strategy headers post-handshake (opt-in)

By default, `SessionAuthStrategy` mirrors the wrapped base strategy's headers (e.g. `Authorization: Basic …` from `BasicAuthStrategy`) onto every post-handshake API request. For stateful backends — Spring Security with 2FA, for instance — re-presenting the base credentials on every call re-triggers the auth filter and either re-prompts, 401s, or invalidates the active session. Opt in to `dropBaseHeaders` to strip them:

```ts
new SessionAuthStrategy(new BasicAuthStrategy(), {
  session: { endpoint: '/session' },
  cookies: { extract: ['SESSION'], applyTo: ['POST', 'PUT', 'DELETE'] },
  dropBaseHeaders: true,
});
```

Base headers are still sent to the `/session` endpoint itself (handshake works as before); only post-handshake API calls carry just cookies + any `headerMirror` headers. Default is `false` for backwards compatibility.

## Project Extensions

The `.apijack/` directory at a project root is auto-loaded when the CLI runs inside that project:

| Path | Purpose |
|------|---------|
| `.apijack/commands/<name>.ts` | Extra CLI subcommands (`default: (program, ctx) => void`) |
| `.apijack/dispatchers/<name>.ts` | Handle non-API commands invoked from routines (`default: (args, posArgs, ctx) => Promise<unknown>`) |
| `.apijack/resolvers/<name>.ts` | Custom `$_*(...)` routine functions |
| `.apijack/auth.ts` | Project-level `AuthStrategy` and optional `onChallenge` |
| `.apijack/plugins.ts` | Project-level plugin registrations (`default: ApijackPlugin[]` — each entry passed to `cli.use(...)`) |
| `.apijack/routines/*.yaml` | Routines available via `routine run <name>` |
| `.apijack/settings.json` | Framework defaults (see below) |
| `.apijack/aliases.json` | Project-local command aliases (see below) |

### Command aliases

Generated leaf-command names come from the OpenAPI `operationId` and can be verbose (e.g. `customers get-customer-order-summary`). `.apijack/aliases.json` is a flat map from a typed alias to the canonical command path:

```json
{
  "customers list":     "customers get-all-customers",
  "customers summary":  "customers get-customer-order-summary",
  "cs":                 "customers get-customer-order-summary"
}
```

Resolution rules:

- Argv is rewritten at CLI bootstrap, before Commander parses. `mycli cs 42 --foo bar` becomes `mycli customers get-customer-order-summary 42 --foo bar`.
- Single-token aliases (`cs`) and multi-token aliases (`customers summary`) use the same mechanism.
- Trailing positional args and flags pass through unchanged.
- Longest-prefix wins when multiple aliases could match.
- An alias that shadows a real command path emits a startup warning and the real command keeps winning.
- An expansion that doesn't resolve to a known command emits a startup error; the CLI continues without that alias applied.
- Before `generate` has run (no generated commands registered), unresolved expansions are skipped silently instead — there is nothing meaningful to validate against yet.
- A global `~/.<cliName>/aliases.json` is also consulted; project-local entries override global entries on conflict.
- **Routines and MCP tool resolution use canonical names only.** Aliases are a CLI ergonomics layer; routine YAML and MCP tool names are not affected.

### Opt-in auth for custom commands and dispatchers

Commands and dispatchers receive a `CliContext` whose `session` is `null` until something resolves it. To get a non-null session, export `requiresAuth`:

```ts
// .apijack/commands/foo.ts
import type { CommandRegistrar } from "@apijack/core";

export const name = "foo";
export const requiresAuth = true;

const register: CommandRegistrar<true> = (program, ctx) => {
  program.command("foo").action(async () => {
    // ctx: AuthedCliContext — ctx.session is non-null
  });
};
export default register;
```

Apply the default to every custom command/dispatcher via `.apijack/settings.json`:

```json
{ "customCommands": { "defaults": { "requiresAuth": true } } }
```

Module-level `requiresAuth` overrides the settings default. On `CliContext`:

- `ctx.resolveSession()` — one-off session resolution without the module flag
- `ctx.saveSession()` — persist `ctx.session` mutations via the wired `SessionManager`

## Built-in Commands

| Command | Description |
|---------|-------------|
| `setup` / `login` | Interactive credential configuration |
| `config list` | List configured environments |
| `config switch <name>` | Switch active environment |
| `generate` | Regenerate CLI from the active environment's OpenAPI spec |
| `routine list` | List available routines |
| `routine run <name>` | Execute a routine |
| `routine validate <name>` | Validate routine YAML |
| `routine test <name>` | Run a routine's spec/test file |

## MCP Server

Run `<cli> mcp` to start a Model Context Protocol server, exposing all CLI commands as MCP tools for use with AI agents and editors.

## Claude Code Integration

This project follows the CLAUDE.md convention for Claude Code. Key patterns:

- **Claude Code skills**: Place skill files in `.claude/skills/<name>/SKILL.md` with YAML frontmatter describing triggers and capabilities
- **Routine authoring**: Use `-o routine-step` to discover command signatures, then compose multi-step YAML routines
- **MCP integration**: Start the MCP server with `<cli> mcp` to expose commands as Claude Code tools
- **Posting markdown to GitHub**: when running `gh issue create`, `gh pr create`, `gh pr review`, `gh issue comment`, etc., always pass the body via `--body-file` (write the markdown to a file first using the `Write` tool). Inline `--body "..."` causes backticks to be silently escaped, posting `\`code\`` artifacts to GitHub.
- **PR body shape**: PRs targeting `dev` must follow `.github/pull_request_template.md` — start with `Closes #<issue-number>` for every issue resolved (one per line), then the standard Summary / What changes / Acceptance criteria / Test plan sections. Without `Closes #`, the issue won't auto-close when the eventual release PR merges into `main`. The template only auto-loads in GitHub's UI; agent-authored PRs use `gh pr create --body-file <file>`, which bypasses that auto-load — so this instruction is what carries the format through. PRs from `dev` → `main` (release PRs) are generated by `ship-release` and have their own format — they do not follow the template.

### Skill File Format

```markdown
---
name: skill-name
description: What this skill does
triggers:
  - keyword or phrase that activates
---

Instructions for the AI agent when this skill is activated.
```
