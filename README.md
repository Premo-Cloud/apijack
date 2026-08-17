# apijack

Jack into any OpenAPI spec and rip a full-featured CLI with AI-agentic workflow automation.

[![npm](https://img.shields.io/npm/v/@apijack/core)](https://www.npmjs.com/package/@apijack/core)
[![tests](https://github.com/normalled/apijack/actions/workflows/ci.yml/badge.svg)](https://github.com/normalled/apijack/actions/workflows/ci.yml)
[![e2e](https://github.com/normalled/apijack/actions/workflows/e2e.yml/badge.svg)](https://github.com/normalled/apijack/actions/workflows/e2e.yml)
[![buy me a coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-orange?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/garreta)

## What is `apijack`?

`apijack` turns any API into a CLI.

```
GET /api/pets
GET /api/pets/{id}
GET /api/owners
GET /api/owners/{id}
```

becomes a command tree that mirrors your API:

```
apijack
├── pets
│   ├── list
│   └── get <id>
└── owners
    ├── list
    └── get <id>
```

```bash
$ apijack pets get 25
```

## Getting Started

```bash
bun install -g @apijack/core
```

```bash
apijack setup              # Configure URL + credentials (Basic auth by default)
apijack generate            # Pull OpenAPI spec, generate types/client/commands
apijack --help              # See all generated commands
```

> **New to apijack?** Follow the [Quickstart](https://github.com/normalled/apijack/wiki/Quickstart) guide with a working example API.

## Claude Code Plugin

Install as a Claude Code plugin to let Claude interact with your APIs directly:

```bash
apijack plugin install
```

Then in Claude Code, run `/reload-plugins`. The plugin exposes MCP tools and skills for setup, code generation, command execution, and routine authoring.

**Example prompt:**

> "Use /setup-api to connect apijack to my todo list API at http://localhost:8080, then use /write-routine to automate an e2e test: create 10 todos and then delete them all."

For other MCP-compatible editors (Cursor, Windsurf, etc.), see [MCP Server Integration](https://github.com/normalled/apijack/wiki/MCP-Server-Integration).

## As a Framework

Build dedicated CLI products with apijack as a dependency:

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

await cli.run();
```

See [Building a CLI](https://github.com/normalled/apijack/wiki/Building-a-CLI) for the full configuration reference.

## Features

- **OpenAPI codegen** -- types, client, and Commander commands from any spec ([details](https://github.com/normalled/apijack/wiki/Code-Generation-Internals))
- **Claude Code plugin** -- one-command setup, MCP server, AI-integrated skills
- **Pluggable auth strategies** -- Basic, Bearer, API Key, Session/CSRF, or build your own ([details](https://github.com/normalled/apijack/wiki/Authentication-Strategies))
- **Secure credential handling** -- dev URLs stored locally, production APIs require env vars ([details](https://github.com/normalled/apijack/wiki/Authentication-Configuration))
- **Multi-environment config** -- switch between dev/staging/prod with `config switch` ([details](https://github.com/normalled/apijack/wiki/Managing-Environments))
- **YAML routine engine** -- variables, conditions, `forEach`, assertions, sub-routines ([details](https://github.com/normalled/apijack/wiki/Writing-Routines))
- **`-o routine-step` export** -- run any command with `-o routine-step` to emit YAML for workflows ([details](https://github.com/normalled/apijack/wiki/Command-Discovery))
- **Project mode** -- project-local config, routines, and extensions ([details](https://github.com/normalled/apijack/wiki/Project-Mode))
- **OpenAPI 3.0 + 3.1** -- comprehensive spec support ([compatibility matrix](https://github.com/normalled/apijack/wiki/OpenAPI-Compatibility))

## Plugins

apijack supports pre-built plugins as standalone npm packages for common utilities. Install via `cli.use(plugin())` and configure per-routine via a top-level `plugins:` block in routine YAML. See `CLAUDE.md` for the full contract and `<cli> plugins list` to inspect registered plugins.

## Documentation

Full documentation is available on the [wiki](https://github.com/normalled/apijack/wiki):

- [Quickstart](https://github.com/normalled/apijack/wiki/Quickstart)
- [Building a CLI](https://github.com/normalled/apijack/wiki/Building-a-CLI)
- [Writing Routines](https://github.com/normalled/apijack/wiki/Writing-Routines)
- [Authentication Strategies](https://github.com/normalled/apijack/wiki/Authentication-Strategies)
- [Session Auth](https://github.com/normalled/apijack/wiki/Session-Auth)
- [Project Mode](https://github.com/normalled/apijack/wiki/Project-Mode)
- [CLI Command Reference](https://github.com/normalled/apijack/wiki/CLI-Command-Reference)
- [Routine YAML Schema](https://github.com/normalled/apijack/wiki/Routine-YAML-Schema)

## Requirements

- [Bun](https://bun.sh) runtime

## License

MIT
