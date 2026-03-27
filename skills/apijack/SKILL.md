---
name: apijack
description: Use when the user mentions apijack or wants to interact with an API via CLI — routes to setup-api or write-routine skills
---

# apijack

Generate full-featured CLIs from OpenAPI specs with AI-agentic workflow automation.

## MCP Tools

When installed as a Claude Code plugin, these tools are available:

| Tool | Purpose |
|------|---------|
| `setup` | Configure API credentials for an environment |
| `generate` | Regenerate CLI from the active environment's OpenAPI spec |
| `run_command` | Run any CLI command by name with flag arguments |
| `run_routine` | Execute a named routine workflow |
| `list_commands` | List available CLI commands (optionally filtered) |
| `list_routines` | List available routines |
| `config_list` | List configured environments |
| `config_switch` | Switch active environment |
| `get_config` | Get active environment config |
| `get_spec` | Get summary of generated API types |

## Skills

- **`/setup-api`** — Connect to an API, configure credentials, generate the CLI
- **`/write-routine`** — Author YAML workflow automations that chain CLI commands

## Getting Started

1. Connect to an API: use `/setup-api` or the `setup` + `generate` MCP tools
2. Explore commands: use `list_commands` to see what's available
3. Automate workflows: use `/write-routine` to build YAML routines
