import { describe, expect, test, mock, beforeEach } from "bun:test";
import { buildDispatcher, type DispatcherConfig } from "../../src/routine/dispatcher";
import type { CliContext, DispatcherHandler, CommandDispatcher } from "../../src/types";

function makeCtx(overrides: Partial<CliContext> = {}): CliContext {
  return {
    client: {},
    session: {} as any,
    auth: {} as any,
    strategy: {} as any,
    refreshSession: mock(async () => {}),
    ...overrides,
  };
}

function makeCommandMap() {
  return {
    "get-user": {
      operationId: "getUserById",
      pathParams: ["userId"],
      queryParams: [],
      hasBody: false,
    },
    "create-user": {
      operationId: "createUser",
      pathParams: [],
      queryParams: [],
      hasBody: true,
    },
    "search-users": {
      operationId: "searchUsers",
      pathParams: [],
      queryParams: ["name", "pageSize"],
      hasBody: false,
    },
    "update-item": {
      operationId: "updateItem",
      pathParams: ["itemId"],
      queryParams: ["force"],
      hasBody: true,
    },
  };
}

function makeClient() {
  return {
    getUserById: mock(async (userId: unknown) => ({ id: userId, name: "Alice" })),
    createUser: mock(async (body: unknown) => ({ id: 1, ...body as object })),
    searchUsers: mock(async (query: unknown) => [{ id: 1, name: "Alice" }]),
    updateItem: mock(async (...args: unknown[]) => ({ updated: true })),
  };
}

describe("buildDispatcher", () => {
  test("dispatches to command-map (calls correct client method with path params)", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    const result = await dispatch("get-user", {}, [42]);

    expect(client.getUserById).toHaveBeenCalledTimes(1);
    expect(client.getUserById).toHaveBeenCalledWith(42);
    expect(result).toEqual({ id: 42, name: "Alice" });
  });

  test("dispatches to command-map with path params from flags (kebab-case)", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    const result = await dispatch("get-user", { "--user-id": 99 }, []);

    expect(client.getUserById).toHaveBeenCalledWith(99);
  });

  test("dispatches to command-map with body args", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    const result = await dispatch("create-user", { "--name": "Bob", "--email": "bob@test.com" });

    expect(client.createUser).toHaveBeenCalledTimes(1);
    expect(client.createUser).toHaveBeenCalledWith({ name: "Bob", email: "bob@test.com" });
  });

  test("dispatches to command-map with --body override (JSON string)", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await dispatch("create-user", { "--body": '{"name":"Charlie"}' });

    expect(client.createUser).toHaveBeenCalledWith({ name: "Charlie" });
  });

  test("dispatches to command-map with query params", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await dispatch("search-users", { "--name": "Alice", "--page-size": 10 });

    expect(client.searchUsers).toHaveBeenCalledTimes(1);
    expect(client.searchUsers).toHaveBeenCalledWith({ name: "Alice", pageSize: 10 });
  });

  test("dispatches to command-map with path params, body, and query params", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await dispatch("update-item", { "--title": "New Title", "--force": true }, [7]);

    expect(client.updateItem).toHaveBeenCalledTimes(1);
    // Path param, then body, then query params
    expect(client.updateItem).toHaveBeenCalledWith(7, { title: "New Title" }, { force: true });
  });

  test("dispatches to consumer-registered handler", async () => {
    const ctx = makeCtx();
    const handler: DispatcherHandler = mock(async (args, positionalArgs, ctx) => {
      return { custom: true, val: args["--key"] };
    });
    const consumerHandlers = new Map<string, DispatcherHandler>();
    consumerHandlers.set("custom-cmd", handler);

    const dispatch = buildDispatcher({
      consumerHandlers,
      ctx,
      routinesDir: "/tmp/routines",
    });

    const result = await dispatch("custom-cmd", { "--key": "value" }, ["pos1"]);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ "--key": "value" }, ["pos1"], ctx);
    expect(result).toEqual({ custom: true, val: "value" });
  });

  test("wait-until polls until truthy result", async () => {
    let callCount = 0;
    const client = {
      checkStatus: mock(async () => {
        callCount++;
        if (callCount < 3) return null;
        return { done: true };
      }),
    };
    const commandMap = {
      "check-status": {
        operationId: "checkStatus",
        pathParams: [],
        queryParams: [],
        hasBody: false,
      },
    };
    const ctx = makeCtx({ client });

    const dispatch = buildDispatcher({
      commandMap,
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    const result = await dispatch("wait-until", { "--interval": 0.01, "--timeout": 5 }, ["check-status"]);

    expect(result).toEqual({ done: true });
    expect(callCount).toBe(3);
  });

  test("wait-until times out and throws", async () => {
    const client = {
      checkStatus: mock(async () => null),
    };
    const commandMap = {
      "check-status": {
        operationId: "checkStatus",
        pathParams: [],
        queryParams: [],
        hasBody: false,
      },
    };
    const ctx = makeCtx({ client });

    const dispatch = buildDispatcher({
      commandMap,
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await expect(
      dispatch("wait-until", { "--interval": 0.01, "--timeout": 0.05 }, ["check-status"]),
    ).rejects.toThrow(/wait-until timed out/);
  });

  test("wait-until passes through non-interval/timeout args to sub-command", async () => {
    let receivedArgs: Record<string, unknown> = {};
    const client = {
      checkStatus: mock(async () => {
        return { ready: true };
      }),
    };
    const commandMap = {
      "check-status": {
        operationId: "checkStatus",
        pathParams: [],
        queryParams: ["filter"],
        hasBody: false,
      },
    };
    const ctx = makeCtx({ client });

    const dispatch = buildDispatcher({
      commandMap,
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await dispatch("wait-until", { "--interval": 0.01, "--timeout": 5, "--filter": "active" }, ["check-status"]);

    expect(client.checkStatus).toHaveBeenCalledWith({ filter: "active" });
  });

  test("session refresh calls ctx.refreshSession()", async () => {
    const ctx = makeCtx();

    const dispatch = buildDispatcher({
      ctx,
      routinesDir: "/tmp/routines",
    });

    const result = await dispatch("session refresh", {});

    expect(ctx.refreshSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ refreshed: true });
  });

  test("routine run loads and executes sub-routine", async () => {
    const ctx = makeCtx();

    // We'll mock the loader and executor at the module level
    const mockLoadRoutineFile = mock(() => ({
      name: "sub-routine",
      steps: [{ name: "step-1", command: "cmd-a" }],
      variables: {},
    }));
    const mockValidateRoutine = mock(() => []);
    const mockExecuteRoutine = mock(async () => ({
      success: true,
      stepsRun: 1,
      stepsSkipped: 0,
      stepsFailed: 0,
    }));

    // Import the module to use the real buildDispatcher but with injected dependencies
    const { buildDispatcher: buildDispatcherReal } = await import("../../src/routine/dispatcher");

    const dispatch = buildDispatcherReal({
      ctx,
      routinesDir: "/tmp/routines",
      _loadRoutineFile: mockLoadRoutineFile as any,
      _validateRoutine: mockValidateRoutine as any,
      _executeRoutine: mockExecuteRoutine as any,
    } as any);

    const result = await dispatch("routine run", { "--set-env": "test" }, ["my-sub"]);

    expect(mockLoadRoutineFile).toHaveBeenCalledWith("my-sub", "/tmp/routines", undefined);
    expect(mockValidateRoutine).toHaveBeenCalled();
    expect(mockExecuteRoutine).toHaveBeenCalled();
    // Check overrides were passed through
    const executeCall = mockExecuteRoutine.mock.calls[0]!;
    expect(executeCall[1]).toEqual({ env: "test" });
    expect(result).toEqual({
      success: true,
      stepsRun: 1,
      stepsSkipped: 0,
      stepsFailed: 0,
    });
  });

  test("routine run throws on validation errors", async () => {
    const ctx = makeCtx();

    const { buildDispatcher: buildDispatcherReal } = await import("../../src/routine/dispatcher");

    const dispatch = buildDispatcherReal({
      ctx,
      routinesDir: "/tmp/routines",
      _loadRoutineFile: mock(() => ({
        name: "bad-routine",
        steps: [{ name: "step-1" }],
        variables: {},
      })) as any,
      _validateRoutine: mock(() => ["Step missing command"]) as any,
      _executeRoutine: mock(async () => ({})) as any,
    } as any);

    await expect(
      dispatch("routine run", {}, ["bad-routine"]),
    ).rejects.toThrow(/validation failed/);
  });

  test("routine run throws on failed sub-routine", async () => {
    const ctx = makeCtx();

    const { buildDispatcher: buildDispatcherReal } = await import("../../src/routine/dispatcher");

    const dispatch = buildDispatcherReal({
      ctx,
      routinesDir: "/tmp/routines",
      _loadRoutineFile: mock(() => ({
        name: "failing-routine",
        steps: [{ name: "step-1", command: "fail" }],
        variables: {},
      })) as any,
      _validateRoutine: mock(() => []) as any,
      _executeRoutine: mock(async () => ({
        success: false,
        stepsRun: 1,
        stepsSkipped: 0,
        stepsFailed: 1,
      })) as any,
    } as any);

    await expect(
      dispatch("routine run", {}, ["failing-routine"]),
    ).rejects.toThrow(/failed/);
  });

  test("pre-dispatch hook is called before dispatch", async () => {
    const callOrder: string[] = [];
    const client = makeClient();
    const originalGetUserById = client.getUserById;
    client.getUserById = mock(async (...args: unknown[]) => {
      callOrder.push("dispatch");
      return originalGetUserById(...args);
    });

    const preDispatch = mock(async (command: string, args: Record<string, unknown>, ctx: CliContext) => {
      callOrder.push("preDispatch");
    });

    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      preDispatch,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await dispatch("get-user", {}, [1]);

    expect(preDispatch).toHaveBeenCalledTimes(1);
    expect(preDispatch).toHaveBeenCalledWith("get-user", {}, ctx);
    expect(callOrder).toEqual(["preDispatch", "dispatch"]);
  });

  test("unknown command throws", async () => {
    const ctx = makeCtx();
    const dispatch = buildDispatcher({
      ctx,
      routinesDir: "/tmp/routines",
    });

    await expect(
      dispatch("nonexistent-command", {}),
    ).rejects.toThrow(/Unknown command: "nonexistent-command"/);
  });

  test("dispatch order: command-map wins over consumer handler for same name", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });

    const consumerHandler: DispatcherHandler = mock(async () => ({ fromConsumer: true }));
    const consumerHandlers = new Map<string, DispatcherHandler>();
    consumerHandlers.set("get-user", consumerHandler);

    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      consumerHandlers,
      ctx,
      routinesDir: "/tmp/routines",
    });

    const result = await dispatch("get-user", {}, [42]);

    // Command-map should win
    expect(client.getUserById).toHaveBeenCalledTimes(1);
    expect(consumerHandler).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 42, name: "Alice" });
  });

  test("command-map body skips path params and query params", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    // update-item has pathParams: ["itemId"], queryParams: ["force"], hasBody: true
    await dispatch("update-item", {
      "--item-id": 5,   // path param (should NOT end up in body)
      "--force": true,  // query param (should NOT end up in body)
      "--title": "New", // body param
    });

    // itemId from flag, body without itemId/force, query with force
    expect(client.updateItem).toHaveBeenCalledWith(5, { title: "New" }, { force: true });
  });

  test("command-map throws if client method not found", async () => {
    const client = {}; // no methods
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: {
        "missing-method": {
          operationId: "doesNotExist",
          pathParams: [],
          queryParams: [],
          hasBody: false,
        },
      },
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await expect(
      dispatch("missing-method", {}),
    ).rejects.toThrow(/Client method "doesNotExist" not found/);
  });

  test("command-map does not pass empty body when hasBody but no args", async () => {
    const client = makeClient();
    const ctx = makeCtx({ client });
    const dispatch = buildDispatcher({
      commandMap: makeCommandMap(),
      client,
      ctx,
      routinesDir: "/tmp/routines",
    });

    await dispatch("create-user", {});

    // Should be called with no arguments (no empty body object)
    expect(client.createUser).toHaveBeenCalledTimes(1);
    expect(client.createUser.mock.calls[0]!.length).toBe(0);
  });
});
