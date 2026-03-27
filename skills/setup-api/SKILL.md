---
name: setup-api
description: Use when connecting apijack to an API — configuring environments, generating the CLI, and switching between configs
---

# Setting Up an API with apijack

Connect apijack to any API with an OpenAPI spec to generate a full CLI.

## Quick Setup

```bash
apijack setup              # Interactive: URL, credentials, auth detection
apijack generate           # Pull spec, generate types/client/commands
apijack --help             # See generated commands
```

## Setup Details

`apijack setup` prompts for:
- **Environment name** (e.g. "dev", "staging")
- **API base URL** (e.g. "http://localhost:8080")
- **Credentials** (username + password, bearer token, or API key)
- **Auth type** is auto-detected from the OpenAPI security schemes

Credentials are stored in `~/.apijack/config.json` for dev URLs. Production URLs require environment variables:

```bash
export APIJACK_URL=https://api.example.com
export APIJACK_USER=user@example.com
export APIJACK_PASS=secret
```

### MCP Setup Tool

When running as a Claude Code plugin, use the `setup` MCP tool instead of the interactive CLI:

```
Use the apijack setup tool to configure environment "dev" at http://localhost:8080
with username admin and password admin123
```

The MCP setup tool only accepts dev/staging URLs. Production APIs must use env vars.

## Multi-Environment

```bash
apijack setup                    # Add another environment
apijack config list              # Show all environments
apijack config switch staging    # Switch active environment
apijack generate                 # Regenerate from new environment's spec
```

## What Generate Produces

`apijack generate` creates four files from the OpenAPI spec:

| File | Contents |
|------|----------|
| `types.ts` | TypeScript interfaces from component schemas |
| `client.ts` | API client with one method per operationId |
| `commands.ts` | Commander subcommands grouped by tags |
| `command-map.ts` | Lookup table mapping command paths to metadata |

After generating, all API operations are available as CLI commands.

## Internal Networks

Allow credential storage for internal IPs:

```bash
apijack plugin config add-cidr 192.168.1.0/24
apijack plugin config add-cidr 10.0.0.0/8
```

## Troubleshooting

- **"No environments configured"** — run `apijack setup` or use the MCP `setup` tool
- **"Command map not available"** — run `apijack generate` after setup
- **"Production API detected"** — use env vars or add the network to allowed CIDRs
- **Auth failures after setup** — try `apijack config switch <env>` to verify active environment, then `apijack generate` to refresh
