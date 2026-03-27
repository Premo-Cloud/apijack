# Credential Security + MCP Setup + README Restructure Design

**Date:** 2026-03-27
**Status:** Approved

## Overview

Three changes in one spec:

1. **Tiered credential storage** — dev URLs store plaintext (current behavior), production URLs are blocked by default, with opt-in override and configurable CIDR allowlists
2. **MCP `setup` tool** — 10th MCP tool for configuring credentials via AI conversation, respecting the same URL classification rules
3. **README restructure** — lead with Claude Code plugin installation, frame package install as the developer alternative

## 1. Credential Security

### URL Classification

When `saveEnvironment()` is called, the URL is classified as **safe** or **production**:

**Safe (plaintext storage allowed):**
- `localhost`, `127.0.0.1`, `::1`
- Hostnames ending in `.local`, `.dev`, `.test`
- Hostnames containing `.staging.`
- IPs matching any configured CIDR allowlist entry

**Production (blocked by default):**
- Everything else

### CIDR Allowlist

Two sources, merged at runtime:

1. **CLI developer** — `CliOptions.allowedCidrs: string[]` (baked into the CLI product)
2. **Plugin user** — `~/.apijack/plugin.json` field `allowedCidrs: string[]` (personal network config)

Both are optional. Default is empty (no private ranges whitelisted). The user can add entries via:
- `<cli> plugin config add-cidr 192.168.1.0/24`
- `<cli> plugin config remove-cidr 192.168.1.0/24`
- Editing `~/.apijack/plugin.json` directly

### Blocked Storage Behavior

When a production URL is detected during `setup`/`login` or `saveEnvironment()`:

```
Production API detected (api.example.com).
Credentials cannot be stored in plaintext for non-development environments.

Options:
  1. Use environment variables: CLINAME_URL, CLINAME_USER, CLINAME_PASS
  2. Add this network to your allowed CIDRs if it's internal
  3. Pass --allow-insecure-storage to override (not recommended)
```

The `--allow-insecure-storage` flag on `setup`/`login`/`config import` bypasses the check and stores plaintext with a warning:

```
WARNING: Storing credentials in plaintext for a production API.
This is not recommended. Consider using environment variables instead.
```

### Config File Format

The `config.json` format is unchanged. Passwords remain in the `environments` object for safe URLs. For production URLs without the override flag, the password field is omitted and auth resolution falls back to env vars.

### Implementation

**New file:** `src/url-classifier.ts`

```typescript
interface ClassificationResult {
  safe: boolean;
  reason: string; // e.g., "localhost", "cidr:192.168.1.0/24", "production"
}

function classifyUrl(
  url: string,
  allowedCidrs?: string[],
): ClassificationResult;

function isPrivateHost(hostname: string): boolean;

function matchesCidr(ip: string, cidr: string): boolean;

function parseCidr(cidr: string): { network: number; mask: number };
```

**Modified:** `src/config.ts`

- `saveEnvironment()` — accepts new `options.allowInsecureStorage?: boolean` and `options.allowedCidrs?: string[]` parameters. Calls `classifyUrl()` before saving. Throws if production URL and no override.
- `resolveAuth()` — unchanged (reads whatever is in config, plus env vars)

**Modified:** `src/cli-builder.ts`

- `setup`/`login` command — add `--allow-insecure-storage` flag
- `config import` command — add `--allow-insecure-storage` flag
- Pass `CliOptions.allowedCidrs` through to `saveEnvironment()`

## 2. MCP Setup Tool

### Tool Definition

10th tool added to `src/mcp-server.ts`:

```
setup:
  name: "setup"
  description: "Configure API credentials for an environment. Only works for
    development URLs (localhost, .local, .dev, .test, .staging, and configured
    CIDR ranges). For production APIs, use environment variables."
  input:
    name: string (required) — environment name
    url: string (required) — API base URL
    user: string (required) — username/email
    password: string (required) — password
  behavior:
    1. Classify URL using classifyUrl() with merged CIDRs
    2. If production: return error with env var instructions
    3. If safe: store in config.json, set as active environment
    4. Return success with environment name
```

### CIDR Merging for MCP

The MCP server reads `allowedCidrs` from `~/.apijack/plugin.json` and passes them to `classifyUrl()`. CLI-developer CIDRs from `CliOptions` are not available in the standalone MCP context (they're baked into the consumer CLI, not apijack itself).

### MCP Does NOT Support `--allow-insecure-storage`

The insecure override is a terminal-only action. The MCP `setup` tool refuses production URLs with no override path. Users must either:
- Use env vars (always work, no storage needed)
- Add the network to `allowedCidrs` in plugin config
- Run `<cli> setup --allow-insecure-storage` directly in a terminal

### Plugin Config Commands

New subcommands under `plugin config`:

- `<cli> plugin config add-cidr <cidr>` — appends to `~/.apijack/plugin.json` `allowedCidrs`
- `<cli> plugin config remove-cidr <cidr>` — removes from `allowedCidrs`
- `<cli> plugin config list` — shows current plugin config including CIDRs

## 3. README Restructure

### New Structure

```markdown
# apijack

Jack into any OpenAPI spec and rip a full-featured CLI
with AI-agentic workflow automation.

[badges]

## Getting Started

### Claude Code Plugin (recommended)

Install as a Claude Code plugin — one command, globally available:

    <cli> plugin install

After installing, restart Claude Code. Then ask Claude to set up
your API connection:

    "Connect to my API at http://localhost:8080"

Claude will configure credentials, discover endpoints, and you're
ready to go. The MCP server exposes all CLI commands as tools.

User data is stored at ~/.apijack/ and survives plugin updates.

### As a Package

For building dedicated CLI products with apijack as a framework:

    bun add apijack

[existing createCli() example]
[existing generate flow]

## Features

[existing feature list, plus:]
- Claude Code plugin — one-command setup, MCP server, skills
- Secure credential handling — dev URLs stored locally,
  production APIs require env vars

## Credential Security

apijack classifies API URLs and restricts credential storage:

- Development (localhost, .local, .dev, .test, .staging, allowed
  CIDRs): credentials stored in ~/.{cli}/config.json
- Production (everything else): credentials blocked from plaintext
  storage. Use environment variables:

      export CLINAME_URL=https://api.example.com
      export CLINAME_USER=user@example.com
      export CLINAME_PASS=secret

  Or pass --allow-insecure-storage to override (not recommended).

Configure allowed CIDRs for internal networks:

    <cli> plugin config add-cidr 192.168.1.0/24

## Routines

[brief routine overview — YAML format, key features,
routine commands, -o routine-step discovery]

## Auth Strategies

[existing auth strategy examples — Basic, Bearer, API Key, Custom]

## MCP Server

[brief section about standalone mcp command for non-plugin use]

## OpenAPI Spec Compatibility

[existing tables — unchanged]

## Requirements

- Bun runtime

## License

MIT
```

## File Changes

| File | Change |
|------|--------|
| `src/url-classifier.ts` | **New** — URL classification + CIDR matching |
| `tests/url-classifier.test.ts` | **New** — classification tests |
| `src/config.ts` | **Modified** — block production URL storage |
| `tests/config.test.ts` | **Modified** — test blocked storage |
| `src/cli-builder.ts` | **Modified** — `--allow-insecure-storage` flag on setup/login/import |
| `src/mcp-server.ts` | **Modified** — add `setup` tool |
| `tests/mcp-server.test.ts` | **Modified** — test setup tool |
| `src/mcp-server-entry.ts` | **Modified** — pass allowedCidrs from plugin config |
| `src/plugin/register.ts` | **Modified** — add `plugin config` subcommands |
| `src/types.ts` | **Modified** — add `allowedCidrs` to `CliOptions` |
| `README.md` | **Rewritten** — plugin-first structure |

## Testing Strategy

- URL classifier: unit tests for localhost, IPv4, IPv6, hostnames, CIDR matching, edge cases
- Config: test that `saveEnvironment()` blocks production URLs, allows dev URLs, respects override flag
- MCP setup: test that it refuses production URLs, accepts dev URLs, merges CIDRs from plugin config
- Integration: `setup` command end-to-end with dev and production URLs
- CIDR commands: add/remove/list round-trip

## Security Audit Notes

Per the security audit conducted on 2026-03-27:
- System keychain (macOS Keychain, Linux libsecret, Windows Credential Manager) provides encryption at rest but no per-application isolation — any same-user process can read stored credentials
- Shell-out approaches (`security`, `secret-tool`, `cmdkey`) expose passwords via process arguments on macOS/Windows
- The block-by-default approach for production URLs eliminates these risks entirely for high-value credentials
- Future enhancement: Bun FFI integration with native keychain APIs could add a secure middle tier between "blocked" and "plaintext override"
- Environment variables are the recommended secure path for production credentials
