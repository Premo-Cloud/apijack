import { describe, expect, test } from "bun:test";
import {
  resolveRef,
  resolveValue,
  resolveArgs,
  resolvePositionalArgs,
} from "../../src/routine/resolver";
import type { RoutineContext } from "../../src/routine/types";

function makeCtx(overrides: Partial<RoutineContext> = {}): RoutineContext {
  return {
    variables: {},
    stepOutputs: new Map(),
    ...overrides,
  };
}

describe("resolveRef", () => {
  test("resolves variables: $myVar returns variable value", () => {
    const ctx = makeCtx({ variables: { myVar: "hello" } });
    expect(resolveRef("myVar", ctx)).toBe("hello");
  });

  test("resolves step outputs: $stepName returns step output", () => {
    const ctx = makeCtx();
    ctx.stepOutputs.set("login", {
      name: "login",
      success: true,
      output: { token: "abc123" },
    });
    expect(resolveRef("login", ctx)).toEqual({ token: "abc123" });
  });

  test("resolves dot paths: $stepName.field", () => {
    const ctx = makeCtx();
    ctx.stepOutputs.set("login", {
      name: "login",
      success: true,
      output: { token: "abc123", user: { id: 42 } },
    });
    expect(resolveRef("login.token", ctx)).toBe("abc123");
    expect(resolveRef("login.user.id", ctx)).toBe(42);
  });

  test("resolves step success via dot path: $stepName.success", () => {
    const ctx = makeCtx();
    ctx.stepOutputs.set("login", {
      name: "login",
      success: true,
      output: "done",
    });
    expect(resolveRef("login.success", ctx)).toBe(true);
  });

  test("resolves forEach item: $item.name", () => {
    const ctx = makeCtx({
      forEachItem: { name: "item", value: { name: "Alice", age: 30 } },
    });
    expect(resolveRef("item", ctx)).toEqual({ name: "Alice", age: 30 });
    expect(resolveRef("item.name", ctx)).toBe("Alice");
    expect(resolveRef("item.age", ctx)).toBe(30);
  });

  test("returns undefined for unknown refs", () => {
    const ctx = makeCtx();
    expect(resolveRef("unknown", ctx)).toBeUndefined();
  });

  test("forEach item takes priority over step outputs", () => {
    const ctx = makeCtx({
      forEachItem: { name: "item", value: "forEach-value" },
    });
    ctx.stepOutputs.set("item", {
      name: "item",
      success: true,
      output: "step-value",
    });
    expect(resolveRef("item", ctx)).toBe("forEach-value");
  });
});

describe("resolveValue", () => {
  test("returns native type for exact $ref match", () => {
    const ctx = makeCtx({ variables: { count: 42 } });
    expect(resolveValue("$count", ctx)).toBe(42);
  });

  test("returns native type for object $ref", () => {
    const obj = { a: 1, b: 2 };
    const ctx = makeCtx({ variables: { data: obj } });
    expect(resolveValue("$data", ctx)).toEqual(obj);
  });

  test("interpolates $refs embedded in strings", () => {
    const ctx = makeCtx({ variables: { name: "world", greeting: "Hello" } });
    expect(resolveValue("$greeting, $name!", ctx)).toBe("Hello, world!");
  });

  test("returns non-string values as-is", () => {
    const ctx = makeCtx();
    expect(resolveValue(42, ctx)).toBe(42);
    expect(resolveValue(true, ctx)).toBe(true);
    expect(resolveValue(null, ctx)).toBeNull();
  });

  test("returns strings without $ as-is", () => {
    const ctx = makeCtx();
    expect(resolveValue("no refs here", ctx)).toBe("no refs here");
  });
});

describe("resolveArgs", () => {
  test("resolves all arg values", () => {
    const ctx = makeCtx({ variables: { host: "localhost", port: 8080 } });
    const args = { url: "http://$host:$port", verbose: true };
    const result = resolveArgs(args, ctx);
    expect(result.url).toBe("http://localhost:8080");
    expect(result.verbose).toBe(true);
  });

  test("returns empty object for undefined args", () => {
    const ctx = makeCtx();
    expect(resolveArgs(undefined, ctx)).toEqual({});
  });
});

describe("resolvePositionalArgs", () => {
  test("resolves all positional arg values", () => {
    const ctx = makeCtx({ variables: { dir: "/tmp" } });
    const args: (string | number)[] = ["$dir", 42, "literal"];
    const result = resolvePositionalArgs(args, ctx);
    expect(result).toEqual(["/tmp", 42, "literal"]);
  });

  test("returns empty array for undefined args", () => {
    const ctx = makeCtx();
    expect(resolvePositionalArgs(undefined, ctx)).toEqual([]);
  });
});
