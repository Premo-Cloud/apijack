import { describe, expect, test, beforeEach } from "bun:test";
import {
  resolveRef,
  resolveValue,
  resolveArgs,
  resolvePositionalArgs,
  resetDistinctPools,
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

// ── Built-in functions ──────────────────────────────────────────────

describe("$_random_hex_color", () => {
  const ctx = makeCtx();

  test("returns a valid hex color as exact match", () => {
    const result = resolveValue("$_random_hex_color", ctx);
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("interpolates inline in a string", () => {
    const result = resolveValue("color: $_random_hex_color", ctx) as string;
    expect(result).toMatch(/^color: #[0-9a-f]{6}$/);
  });

  test("generates different values on repeated calls", () => {
    const results = new Set<unknown>();
    for (let i = 0; i < 20; i++) {
      results.add(resolveValue("$_random_hex_color", ctx));
    }
    // With 20 random colors, we should get at least 2 distinct values
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("$_uuid", () => {
  const ctx = makeCtx();

  test("returns a valid UUID", () => {
    const result = resolveValue("$_uuid", ctx) as string;
    expect(result).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  test("generates unique values each call", () => {
    const a = resolveValue("$_uuid", ctx);
    const b = resolveValue("$_uuid", ctx);
    expect(a).not.toBe(b);
  });
});

describe("$_random_int", () => {
  const ctx = makeCtx();

  test("returns an integer in range", () => {
    for (let i = 0; i < 50; i++) {
      const result = resolveValue("$_random_int(1,10)", ctx) as number;
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(10);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  test("returns 0 with no args", () => {
    const result = resolveValue("$_random_int()", ctx);
    expect(result).toBe(0);
  });

  test("handles single-value range", () => {
    const result = resolveValue("$_random_int(5,5)", ctx);
    expect(result).toBe(5);
  });

  test("interpolates inline", () => {
    const result = resolveValue("count-$_random_int(1,100)", ctx) as string;
    expect(result).toMatch(/^count-\d+$/);
  });
});

describe("$_random_from", () => {
  const ctx = makeCtx();

  test("returns one of the provided options", () => {
    for (let i = 0; i < 30; i++) {
      const result = resolveValue("$_random_from(red,green,blue)", ctx);
      expect(["red", "green", "blue"]).toContain(result);
    }
  });

  test("returns empty string with no args", () => {
    expect(resolveValue("$_random_from()", ctx)).toBe("");
  });

  test("handles single option", () => {
    expect(resolveValue("$_random_from(only)", ctx)).toBe("only");
  });

  test("handles spaces in args", () => {
    const result = resolveValue("$_random_from( a , b , c )", ctx);
    expect(["a", "b", "c"]).toContain(result);
  });

  test("can produce different values (not deterministic)", () => {
    const results = new Set<unknown>();
    for (let i = 0; i < 50; i++) {
      results.add(resolveValue("$_random_from(x,y,z)", ctx));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("$_random_distinct_from", () => {
  const ctx = makeCtx();

  beforeEach(() => {
    resetDistinctPools();
  });

  test("returns each value exactly once before repeating", () => {
    const values = ["a", "b", "c"];
    const results: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(resolveValue("$_random_distinct_from(a,b,c)", ctx));
    }
    // All three values should appear exactly once
    expect(results.sort()).toEqual(["a", "b", "c"]);
  });

  test("cycles after exhaustion", () => {
    const results: unknown[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(resolveValue("$_random_distinct_from(x,y)", ctx));
    }
    // First 2 should be x,y in some order; next 2 should be x,y again
    const firstBatch = results.slice(0, 2).sort();
    const secondBatch = results.slice(2, 4).sort();
    const thirdBatch = results.slice(4, 6).sort();
    expect(firstBatch).toEqual(["x", "y"]);
    expect(secondBatch).toEqual(["x", "y"]);
    expect(thirdBatch).toEqual(["x", "y"]);
  });

  test("separate pools for different arg lists", () => {
    const pool1: unknown[] = [];
    const pool2: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      pool1.push(resolveValue("$_random_distinct_from(a,b)", ctx));
      pool2.push(resolveValue("$_random_distinct_from(x,y)", ctx));
    }
    expect(pool1.sort()).toEqual(["a", "b"]);
    expect(pool2.sort()).toEqual(["x", "y"]);
  });

  test("returns empty string with no args", () => {
    expect(resolveValue("$_random_distinct_from()", ctx)).toBe("");
  });

  test("handles single value", () => {
    const result = resolveValue("$_random_distinct_from(only)", ctx);
    expect(result).toBe("only");
  });
});
