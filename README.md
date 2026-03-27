# apijack

Jack into any OpenAPI spec and rip a full-featured CLI with AI-agentic workflow automation.

[![tests](https://github.com/Premo-Cloud/apijack/actions/workflows/ci.yml/badge.svg)](https://github.com/Premo-Cloud/apijack/actions/workflows/ci.yml)
[![e2e](https://github.com/Premo-Cloud/apijack/actions/workflows/e2e.yml/badge.svg)](https://github.com/Premo-Cloud/apijack/actions/workflows/e2e.yml)
[![buy me a coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-orange?logo=buy-me-a-coffee)](https://www.buymeacoffee.com/garreta)


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
| `--body` / `--body-file` overrides | :white_check_mark: | Raw JSON escape hatch |
| Typed response resolution | :white_check_mark: | 200, 201, 202, 204 |
| Operation `summary` / `description` | :white_check_mark: | CLI descriptions, JSDoc |
| `deprecated` operations | :white_check_mark: | `[DEPRECATED]` marker, JSDoc |
| Tag-based command grouping | :white_check_mark: | Normalized (lowercase, split on whitespace/slashes/colons) |
| Verb deduplication | :white_check_mark: | Falls back to operationId kebab-case |
| `-o routine-step` YAML export | :white_check_mark: | Build workflows interactively |
| Variant-specific flags | :white_check_mark: | Hidden by default, `--verbose` to show |
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

## License

MIT


<a href="https://www.buymeacoffee.com/garreta"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=garreta&button_colour=FFDD00&font_colour=000000&font_family=Lato&outline_colour=000000&coffee_colour=ffffff" /></a>
