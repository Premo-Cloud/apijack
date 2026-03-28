# apijack

Jack into any OpenAPI spec and rip a full-featured CLI with AI-agentic workflow automation.

[![npm](https://img.shields.io/npm/v/@apijack/core)](https://www.npmjs.com/package/@apijack/core)
[![tests](https://github.com/Premo-Cloud/apijack/actions/workflows/ci.yml/badge.svg)](https://github.com/Premo-Cloud/apijack/actions/workflows/ci.yml)
[![e2e](https://github.com/Premo-Cloud/apijack/actions/workflows/e2e.yml/badge.svg)](https://github.com/Premo-Cloud/apijack/actions/workflows/e2e.yml)
[![buy me a coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-orange?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/garreta)

## Getting Started

```bash
bun install -g @apijack/core
```

### Claude Code Plugin

Install as a Claude Code plugin to let Claude interact with your APIs directly:

```bash
apijack plugin install
```

Then in Claude Code, run `/reload-plugins`. The plugin exposes 10 MCP tools and 3 skills:

### MCP Tools

| Tool | Description |
|------|-------------|
| `setup` | Configure API credentials for an environment |
| `generate` | Regenerate CLI from the active environment's OpenAPI spec |
| `run_commands` | Run one or more CLI commands sequentially |
| `run_routine` | Execute a named routine workflow |
| `list_commands` | List available CLI commands (optionally filtered) |
| `list_routines` | List available routines |
| `get_routine_templates` | Get YAML routine step templates for commands |
| `config_list` | List configured environments |
| `config_switch` | Switch active environment |
| `get_config` | Get active environment config |
| `get_spec` | Get summary of generated API types |

### Skills

| Skill | Description |
|-------|-------------|
| `/setup-api` | Connect to an API, configure credentials, generate the CLI |
| `/write-routine` | Author YAML workflow automations that chain CLI commands |

### Example Prompt

> "Use /setup-api to connect apijack to my todo list API at http://localhost:8080, then use /write-routine to automate an e2e test: create 10 todos and then delete them all."

### Direct CLI Usage

Use apijack directly from the terminal without the plugin:

```bash
apijack setup              # Configure URL + credentials (auth auto-detected)
apijack generate            # Pull OpenAPI spec, generate types/client/commands
apijack --help              # See all generated commands
```

## As a Framework

For building dedicated CLI products with apijack as a framework:

```bash
bun add @apijack/core
```

```ts
import { createCli, BasicAuthStrategy } from "@apijack/core";

const cli = createCli({
  name: "mycli",
  description: "My API CLI",
  version: "1.0.0",
  specPath: "/v3/api-docs",
  auth: new BasicAuthStrategy(),
});

cli.run();
```

Generate your CLI from a running API:

```bash
mycli setup        # Configure URL + credentials
mycli generate     # Pull OpenAPI spec, generate types/client/commands
mycli --help       # See all generated commands
```

## Features

- **OpenAPI codegen** -- types, client, and Commander commands from any spec
- **Claude Code plugin** -- one-command setup, MCP server, AI-integrated skills
- **Pluggable auth strategies** -- Basic, Bearer, API Key, or build your own
- **Secure credential handling** -- dev URLs stored locally, production APIs require env vars
- **Multi-environment config** -- switch between dev/staging/prod with `config switch`
- **YAML routine engine** -- variables, conditions, `forEach`, assertions, sub-routines
- **Composable dispatcher** -- built-in meta-commands (`wait-until`, session refresh, sub-routines)
- **`-o routine-step` export** -- run any command with `-o routine-step` to emit YAML you can paste into workflows
- **Built-in commands** -- `setup`, `config`, `generate`, `routine run/list/validate/test`, `plugin`

## Credential Security

apijack classifies API URLs and restricts credential storage:

**Development** (localhost, 127.0.0.1, ::1, allowed CIDRs): credentials stored in `~/.{cli}/config.json`.

**Production** (everything else): credentials blocked from plaintext storage. Use environment variables:

```bash
export MYCLI_URL=https://api.example.com
export MYCLI_USER=user@example.com
export MYCLI_PASS=secret
```

Or pass `--allow-insecure-storage` to override (not recommended).

### Internal Networks

Configure allowed CIDRs for internal networks:

```bash
apijack plugin config add-cidr 192.168.1.0/24
apijack plugin config add-cidr 10.0.0.0/8
```

CLI developers can also set defaults:

```ts
createCli({
  // ...
  allowedCidrs: ["192.168.0.0/16", "10.0.0.0/8"],
});
```

## Project Mode

Drop an `.apijack.json` in your project root to make apijack project-aware:

```json
{
  "name": "my-api",
  "specUrl": "http://localhost:8080/v3/api-docs",
  "generatedDir": "./src/generated"
}
```

With a project file, apijack:
- Reads defaults from `.apijack.json` (committed to git)
- Stores credentials in `.apijack/config.json` (add `.apijack/` to `.gitignore`)
- Generates files to your project's configured directory
- Loads routines from `./routines/` in addition to global ones

### Project Extensions

Extend apijack with project-local code in `.apijack/`:

```
.apijack/
├── config.json          # credentials (gitignored)
├── auth.ts              # custom auth strategy (export default)
├── commands/            # custom commands (each file exports a registrar)
│   └── deploy.ts
└── dispatchers/         # custom dispatchers (each file exports a handler)
    └── notify.ts
```

**Custom auth** (`.apijack/auth.ts`):
```ts
export default {
  async authenticate(config) {
    const token = await fetchToken(config);
    return { headers: { Authorization: `Bearer ${token}` } };
  },
  async restore(cached) { return cached; },
};
```

**Custom command** (`.apijack/commands/deploy.ts`):
```ts
export const name = 'deploy';
export default function register(program, ctx) {
  program.command('deploy')
    .description('Deploy the current environment')
    .action(async () => { /* ... */ });
}
```

Without a project file, apijack runs in global mode using `~/.apijack/`.

## Routines

Routines are YAML-based workflow definitions stored in `~/.{cli}/routines/`. They chain CLI commands with variables, conditionals, loops, assertions, and sub-routines.

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
```

Discover command signatures for building routines:

```bash
mycli resources create --name test -o routine-step
```

## Auth Strategies

### Basic Auth

```ts
import { BasicAuthStrategy } from "@apijack/core";
const auth = new BasicAuthStrategy();
```

### Bearer Token

```ts
import { BearerTokenStrategy } from "@apijack/core";
const auth = new BearerTokenStrategy(async (config) => {
  const res = await fetch(`${config.baseUrl}/oauth/token`, {
    method: "POST",
    body: JSON.stringify({ username: config.username, password: config.password }),
  });
  const { access_token } = await res.json();
  return access_token;
});
```

### API Key

```ts
import { ApiKeyStrategy } from "@apijack/core";
const auth = new ApiKeyStrategy("X-API-Key", "your-api-key");
```

### Custom

Implement the `AuthStrategy` interface:

```ts
import type { AuthStrategy, AuthSession, ResolvedAuth } from "@apijack/core";

class MyStrategy implements AuthStrategy {
  async authenticate(config: ResolvedAuth): Promise<AuthSession> {
    return { headers: { Authorization: "Custom ..." } };
  }
  async restore(cached: AuthSession): Promise<AuthSession | null> {
    return cached;
  }
}
```

## MCP Server (Other Editors)

For MCP-compatible editors other than Claude Code (Cursor, Windsurf, etc.), add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "apijack": {
      "type": "stdio",
      "command": "apijack",
      "args": ["mcp"]
    }
  }
}
```

This exposes the same 10 tools as the Claude Code plugin.

## OpenAPI Spec Compatibility

### OpenAPI 3.0

| Feature | Status | Notes |
|---------|--------|-------|
| **Schemas** | | |
| Primitive types (`string`, `number`, `integer`, `boolean`) | :white_check_mark: | |
| `$ref` resolution | :white_check_mark: | Recursive refs handled |
| `allOf` composition | :white_check_mark: | Intersection types, inline members with JSDoc |
| `oneOf` / `anyOf` | :white_check_mark: | Union types, inline variant resolution |
| Discriminated unions (`discriminator` + `mapping`) | :white_check_mark: | Tagged union output |
| `enum` types | :white_check_mark: | String literal unions |
| `nullable` | :white_check_mark: | `T \| null` |
| `array` with `items` | :white_check_mark: | Wraps union/intersection in parens |
| Nested inline objects | :white_check_mark: | Up to depth 3 |
| `additionalProperties` | :white_check_mark: | Typed and untyped index signatures |
| `required` fields | :white_check_mark: | Non-optional properties, `requiredOption` in CLI |
| `readOnly` / `writeOnly` | :white_check_mark: | readOnly skipped from CLI flags, JSDoc annotated |
| `default` values | :white_check_mark: | JSDoc `@default` tag |
| `format` hints | :white_check_mark: | `date-time`, `email`, `uri`, `uuid`, `int32`, `int64`, `float`, `double` |
| Constraints | :white_check_mark: | `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems` |
| `example` values | :white_check_mark: | JSDoc `@example` tag |
| `deprecated` schemas | :white_check_mark: | JSDoc `@deprecated` tag |
| **Operations** | | |
| Path parameters | :white_check_mark: | CLI positional args, `@param` JSDoc |
| Query parameters | :white_check_mark: | With enum, default, format, description |
| Path-level parameters | :white_check_mark: | Merged with operation-level |
| Parameter `style` / `explode` | :white_check_mark: | JSDoc annotation |
| JSON request bodies | :white_check_mark: | Property decomposition to CLI flags |
| Primitive body types | :white_check_mark: | `string`, `number`, `boolean`, `string[]`, `number[]` |
| Array request bodies | :white_check_mark: | |
| Typed response resolution | :white_check_mark: | 200, 201, 202, 204 |
| Operation `summary` / `description` | :white_check_mark: | CLI descriptions, JSDoc |
| `deprecated` operations | :white_check_mark: | `[DEPRECATED]` marker, JSDoc |
| Tag-based command grouping | :white_check_mark: | Normalized (lowercase, split on whitespace/slashes/colons) |
| Verb deduplication | :white_check_mark: | Falls back to operationId kebab-case |
| `-o routine-step` YAML export | :white_check_mark: | Build workflows interactively |
| Variant-specific flags | :white_check_mark: | Hidden by default, `-V` to show |
| **Not Yet Supported** | | |
| `multipart/form-data` bodies | :x: | Use custom commands |
| Multiple content types per operation | :x: | |
| Response headers | :x: | |
| Cookie parameters | :x: | |
| OAuth2 / OpenID Connect schemes | :x: | Use custom `AuthStrategy` |
| Callbacks / Webhooks | :x: | |
| `links` on responses | :x: | |
| XML request/response bodies | :x: | |
| Server variables / templating | :x: | |

### OpenAPI 3.1

| Feature | Status | Notes |
|---------|--------|-------|
| Type arrays (`["string", "null"]`) | :white_check_mark: | Emits union type `string \| null` |
| `const` values | :white_check_mark: | Literal types, `@const` JSDoc |
| `$defs` (local definitions) | :white_check_mark: | Flattened into schema map |
| `$ref` siblings (properties alongside `$ref`) | :white_check_mark: | Merged as intersection |
| `not` (negation) | :white_check_mark: | `Exclude<>` types, `@not` JSDoc |
| `prefixItems` (tuples) | :white_check_mark: | `[string, number, ...]` tuple types |
| `patternProperties` | :white_check_mark: | Typed index signatures |
| Widened `enum` (number, boolean, null values) | :white_check_mark: | Mixed literal unions |
| `multipleOf` constraint | :white_check_mark: | JSDoc `@multipleOf` tag |
| `minProperties` / `maxProperties` | :white_check_mark: | JSDoc annotations |
| `contentMediaType` / `contentEncoding` | :x: | |
| `if` / `then` / `else` | :x: | |
| `dependentRequired` / `dependentSchemas` | :x: | |
| JSON Schema `$id` / `$anchor` | :x: | |
| `unevaluatedProperties` | :x: | |

## Requirements

- [Bun](https://bun.sh) runtime

## License

MIT
