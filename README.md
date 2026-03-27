# apijack

[![Tests](https://github.com/Premo-Cloud/apijack/actions/workflows/ci.yml/badge.svg)](https://github.com/Premo-Cloud/apijack/actions/workflows/ci.yml)
[![E2E](https://github.com/Premo-Cloud/apijack/actions/workflows/e2e.yml/badge.svg)](https://github.com/Premo-Cloud/apijack/actions/workflows/e2e.yml)

Jack into any OpenAPI spec and rip a full-featured CLI with AI-agentic workflow automation.

## Install

```bash
bun add apijack
```

## Quick Start

```ts
import { createCli, BasicAuthStrategy } from "apijack";

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
- **Pluggable auth strategies** -- Basic, Bearer, API Key, or build your own
- **Multi-environment config** -- switch between dev/staging/prod with `config switch`
- **YAML routine engine** -- variables, conditions, `forEach`, assertions, sub-routines
- **Composable dispatcher** -- built-in meta-commands (`wait-until`, session refresh, sub-routines)
- **`-o routine-step` export** -- run any command with `-o routine-step` to emit YAML you can paste into workflows
- **Built-in commands** -- `setup`, `config`, `generate`, `routine run/list/validate/test`

## Auth Strategies

### Basic Auth

```ts
import { BasicAuthStrategy } from "apijack";
const auth = new BasicAuthStrategy();
```

### Bearer Token

```ts
import { BearerTokenStrategy } from "apijack";
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
import { ApiKeyStrategy } from "apijack";
const auth = new ApiKeyStrategy("X-API-Key", "your-api-key");
```

### Custom

Implement the `AuthStrategy` interface:

```ts
import type { AuthStrategy, AuthSession, ResolvedAuth } from "apijack";

class MyStrategy implements AuthStrategy {
  async authenticate(config: ResolvedAuth): Promise<AuthSession> {
    return { headers: { Authorization: "Custom ..." } };
  }
  async restore(cached: AuthSession): Promise<AuthSession | null> {
    return cached;
  }
}
```

## Requirements

- [Bun](https://bun.sh) runtime

## OpenAPI Spec Compatibility

### Schema Features

- [x] Primitive types (`string`, `number`, `integer`, `boolean`)
- [x] `$ref` resolution
- [x] `allOf` composition (intersection types)
- [x] `oneOf` / `anyOf` (union types)
- [x] Discriminated unions (`discriminator` with `mapping`)
- [x] `enum` types
- [x] `nullable` properties
- [x] `array` types with `items`
- [x] Nested inline object types (up to depth 3)
- [x] `additionalProperties` (typed and untyped)
- [x] `required` field tracking
- [x] `readOnly` / `writeOnly` properties
- [x] `default` values
- [x] `format` hints (`date-time`, `email`, `uri`, `uuid`, `int32`, `int64`, `float`, `double`)
- [x] Constraint annotations (`minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems`)
- [x] `example` values
- [x] `deprecated` schemas

### Operation Features

- [x] Path parameters
- [x] Query parameters (with enum, default, format)
- [x] JSON request bodies with property decomposition to CLI flags
- [x] Primitive body types (`string`, `number`, `boolean`, `string[]`, `number[]`)
- [x] Array request bodies
- [x] `--body` / `--body-file` raw overrides
- [x] Typed response resolution (200, 201, 202, 204)
- [x] Operation `summary` and `description`
- [x] `deprecated` operations
- [x] JSDoc generation on client methods
- [x] `@param` tags for path, query, and body parameters
- [x] Tag-based command grouping with normalization
- [x] Verb deduplication (falls back to operationId kebab-case)
- [x] `-o routine-step` YAML export
- [x] Variant-specific flags (hidden, shown with `--verbose`)

### Not Yet Supported

- [ ] `multipart/form-data` request bodies (codegen skips, use custom commands)
- [ ] Multiple content types per operation
- [ ] Response headers
- [ ] Cookie parameters
- [ ] OAuth2 / OpenID Connect security schemes (use custom `AuthStrategy`)
- [ ] Callbacks / Webhooks
- [ ] `links` on responses
- [ ] XML request/response bodies
- [ ] Server variables / templating

## License

MIT
