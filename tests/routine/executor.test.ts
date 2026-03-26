import { describe, expect, test, mock } from "bun:test";
import { executeRoutine } from "../../src/routine/executor";
import type { RoutineDefinition, RoutineStep } from "../../src/routine/types";
import type { CommandDispatcher } from "../../src/types";

function makeRoutine(overrides: Partial<RoutineDefinition> = {}): RoutineDefinition {
  return {
    name: "test-routine",
    steps: [],
    variables: {},
    ...overrides,
  };
}

function makeMockDispatcher(results: Record<string, unknown> = {}) {
  const calls: { command: string; args: Record<string, unknown>; positionalArgs?: unknown[] }[] = [];
  const dispatcher: CommandDispatcher = async (command, args, positionalArgs) => {
    calls.push({ command, args, positionalArgs });
    if (command in results) return results[command];
    return { ok: true };
  };
  return { dispatcher, calls };
}

describe("executeRoutine", () => {
  test("runs steps sequentially, calls dispatcher for each", async () => {
    const routine = makeRoutine({
      steps: [
        { name: "step-1", command: "cmd-a", args: { key: "val1" } },
        { name: "step-2", command: "cmd-b", args: { key: "val2" } },
      ],
    });
    const { dispatcher, calls } = makeMockDispatcher();
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(true);
    expect(result.stepsRun).toBe(2);
    expect(result.stepsSkipped).toBe(0);
    expect(result.stepsFailed).toBe(0);
    expect(calls.length).toBe(2);
    expect(calls[0]!.command).toBe("cmd-a");
    expect(calls[1]!.command).toBe("cmd-b");
  });

  test("skips steps where condition is false", async () => {
    const routine = makeRoutine({
      variables: { enabled: false },
      steps: [
        { name: "skipped", command: "cmd-a", condition: "$enabled" },
        { name: "run", command: "cmd-b" },
      ],
    });
    const { dispatcher, calls } = makeMockDispatcher();
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(true);
    expect(result.stepsRun).toBe(1);
    expect(result.stepsSkipped).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0]!.command).toBe("cmd-b");
  });

  test("forEach iterates over array", async () => {
    const routine = makeRoutine({
      variables: { items: ["a", "b", "c"] },
      steps: [
        {
          name: "loop",
          forEach: "$items",
          as: "item",
          steps: [
            { name: "inner", command: "process", args: { value: "$item" } },
          ],
        },
      ],
    });
    const { dispatcher, calls } = makeMockDispatcher();
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(true);
    expect(calls.length).toBe(3);
    expect(calls[0]!.args.value).toBe("a");
    expect(calls[1]!.args.value).toBe("b");
    expect(calls[2]!.args.value).toBe("c");
  });

  test("assertions pass correctly", async () => {
    const routine = makeRoutine({
      steps: [
        {
          name: "check",
          command: "cmd-a",
          assert: "$check.success == true",
        },
      ],
    });
    const { dispatcher } = makeMockDispatcher({ "cmd-a": { status: "ok" } });
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(true);
    expect(result.stepsFailed).toBe(0);
  });

  test("assertions fail correctly", async () => {
    const routine = makeRoutine({
      steps: [
        {
          name: "check",
          command: "cmd-a",
          assert: "$check.success == false",
        },
      ],
    });
    const { dispatcher } = makeMockDispatcher({ "cmd-a": { status: "ok" } });
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(false);
    expect(result.stepsFailed).toBe(1);
  });

  test("continueOnError allows continued execution", async () => {
    const failDispatcher: CommandDispatcher = async (command) => {
      if (command === "fail-cmd") throw new Error("boom");
      return { ok: true };
    };

    const routine = makeRoutine({
      steps: [
        { name: "will-fail", command: "fail-cmd", continueOnError: true },
        { name: "will-run", command: "ok-cmd" },
      ],
    });
    const result = await executeRoutine(routine, {}, failDispatcher);

    expect(result.success).toBe(false); // stepsFailed > 0
    expect(result.stepsRun).toBe(2);
    expect(result.stepsFailed).toBe(1);
  });

  test("dry run prints without executing", async () => {
    const routine = makeRoutine({
      steps: [
        { name: "step-1", command: "cmd-a", args: { key: "val" } },
        { name: "step-2", command: "cmd-b" },
      ],
    });
    const { dispatcher, calls } = makeMockDispatcher();
    const result = await executeRoutine(routine, {}, dispatcher, { dryRun: true });

    expect(result.stepsRun).toBe(2);
    expect(calls.length).toBe(0); // dispatcher never called
  });

  test("step outputs accessible via $stepName", async () => {
    const routine = makeRoutine({
      steps: [
        { name: "create", command: "create-thing" },
        { name: "use", command: "use-thing", args: { id: "$create.id" } },
      ],
    });
    const callIndex = { i: 0 };
    const dispatcher: CommandDispatcher = async (command) => {
      callIndex.i++;
      if (command === "create-thing") return { id: 42 };
      return { ok: true };
    };
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(true);
    expect(result.stepsRun).toBe(2);
  });

  test("step outputs accessible via output alias", async () => {
    const routine = makeRoutine({
      steps: [
        { name: "create", command: "create-thing", output: "created" },
        { name: "use", command: "use-thing", args: { id: "$created.id" } },
      ],
    });
    const dispatched: Record<string, unknown>[] = [];
    const dispatcher: CommandDispatcher = async (command, args) => {
      dispatched.push(args);
      if (command === "create-thing") return { id: 99 };
      return { ok: true };
    };
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(true);
    expect(dispatched[1]!.id).toBe(99);
  });

  test("variable overrides merge with defaults", async () => {
    const routine = makeRoutine({
      variables: { greeting: "hello", target: "world" },
      steps: [
        { name: "greet", command: "say", args: { msg: "$greeting $target" } },
      ],
    });
    const dispatched: Record<string, unknown>[] = [];
    const dispatcher: CommandDispatcher = async (_cmd, args) => {
      dispatched.push(args);
      return {};
    };
    const result = await executeRoutine(routine, { target: "universe" }, dispatcher);

    expect(result.success).toBe(true);
    expect(dispatched[0]!.msg).toBe("hello universe");
  });

  test("built-in $_timestamp and $_date available", async () => {
    const routine = makeRoutine({
      steps: [
        { name: "check", command: "cmd", args: { ts: "$_timestamp", dt: "$_date" } },
      ],
    });
    const dispatched: Record<string, unknown>[] = [];
    const dispatcher: CommandDispatcher = async (_cmd, args) => {
      dispatched.push(args);
      return {};
    };
    const result = await executeRoutine(routine, {}, dispatcher);

    expect(result.success).toBe(true);
    const ts = dispatched[0]!.ts as number;
    const dt = dispatched[0]!.dt as string;
    // Timestamp should be a reasonable Unix epoch (seconds)
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThan(1700000000);
    // Date should be ISO format YYYY-MM-DD
    expect(dt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("onStep callback is called for each step", async () => {
    const routine = makeRoutine({
      steps: [
        { name: "a", command: "cmd-a" },
        { name: "b", command: "cmd-b" },
      ],
    });
    const { dispatcher } = makeMockDispatcher();
    const stepCalls: { name: string; index: number; total: number }[] = [];
    const result = await executeRoutine(routine, {}, dispatcher, {
      onStep: (step, index, total) => {
        stepCalls.push({ name: step.name, index, total });
      },
    });

    expect(result.success).toBe(true);
    expect(stepCalls.length).toBe(2);
    expect(stepCalls[0]).toEqual({ name: "a", index: 0, total: 2 });
    expect(stepCalls[1]).toEqual({ name: "b", index: 1, total: 2 });
  });

  test("error without continueOnError stops execution", async () => {
    const failDispatcher: CommandDispatcher = async (command) => {
      if (command === "fail-cmd") throw new Error("boom");
      return { ok: true };
    };

    const routine = makeRoutine({
      steps: [
        { name: "will-fail", command: "fail-cmd" },
        { name: "wont-run", command: "ok-cmd" },
      ],
    });
    const result = await executeRoutine(routine, {}, failDispatcher);

    expect(result.success).toBe(false);
    expect(result.stepsRun).toBe(1);
    expect(result.stepsFailed).toBe(1);
  });

  test("$_timestamp resolved in default variables", async () => {
    const routine = makeRoutine({
      variables: { label: "run-$_timestamp" },
      steps: [
        { name: "check", command: "cmd", args: { label: "$label" } },
      ],
    });
    const dispatched: Record<string, unknown>[] = [];
    const dispatcher: CommandDispatcher = async (_cmd, args) => {
      dispatched.push(args);
      return {};
    };
    await executeRoutine(routine, {}, dispatcher);

    const label = dispatched[0]!.label as string;
    expect(label).toMatch(/^run-\d+$/);
  });
});
