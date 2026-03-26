import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parseRoutine,
  validateRoutine,
  loadRoutineFile,
  listRoutines,
  formatRoutineTree,
  formatRoutineList,
  loadSpecFile,
} from "../../src/routine/loader";

const TEST_DIR = join(tmpdir(), `loader-test-${Date.now()}`);

function makeTestDir() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanTestDir() {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

describe("parseRoutine", () => {
  test("parses valid YAML", () => {
    const yaml = `
name: test-routine
description: A test routine
variables:
  foo: bar
steps:
  - name: step-1
    command: do-something
    args:
      key: value
`;
    const routine = parseRoutine(yaml);
    expect(routine.name).toBe("test-routine");
    expect(routine.description).toBe("A test routine");
    expect(routine.variables).toEqual({ foo: "bar" });
    expect(routine.steps.length).toBe(1);
    expect(routine.steps[0]!.name).toBe("step-1");
    expect(routine.steps[0]!.command).toBe("do-something");
  });

  test("throws on missing name", () => {
    const yaml = `
steps:
  - name: step-1
    command: do-something
`;
    expect(() => parseRoutine(yaml)).toThrow("Routine must have a 'name' field");
  });

  test("throws on missing steps", () => {
    const yaml = `
name: test-routine
`;
    expect(() => parseRoutine(yaml)).toThrow("Routine must have 'steps' array");
  });

  test("throws on empty steps", () => {
    const yaml = `
name: test-routine
steps: []
`;
    expect(() => parseRoutine(yaml)).toThrow("Routine must have 'steps' array");
  });

  test("throws on invalid YAML", () => {
    expect(() => parseRoutine("")).toThrow("Invalid YAML");
  });
});

describe("validateRoutine", () => {
  test("returns empty array for valid routine", () => {
    const routine = parseRoutine(`
name: valid
steps:
  - name: step-1
    command: do-something
`);
    const errors = validateRoutine(routine);
    expect(errors).toEqual([]);
  });

  test("catches duplicate step names", () => {
    const routine = parseRoutine(`
name: dupes
steps:
  - name: step-1
    command: do-a
  - name: step-1
    command: do-b
`);
    const errors = validateRoutine(routine);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Duplicate step name");
    expect(errors[0]).toContain("step-1");
  });

  test("catches output alias collisions", () => {
    const routine = parseRoutine(`
name: collision
steps:
  - name: step-1
    command: do-a
    output: result
  - name: step-2
    command: do-b
    output: result
`);
    const errors = validateRoutine(routine);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Output alias collision");
    expect(errors[0]).toContain("result");
  });

  test("catches output alias collision with step name", () => {
    const routine = parseRoutine(`
name: collision
steps:
  - name: step-1
    command: do-a
  - name: step-2
    command: do-b
    output: step-1
`);
    const errors = validateRoutine(routine);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Output alias collision");
  });

  test("catches steps without command or forEach", () => {
    const routine = parseRoutine(`
name: no-cmd
steps:
  - name: step-1
    args:
      key: value
`);
    const errors = validateRoutine(routine);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("must have 'command' or 'forEach'");
  });

  test("validates nested forEach steps", () => {
    const routine = parseRoutine(`
name: nested
steps:
  - name: loop
    forEach: "$items"
    steps:
      - name: inner-a
        command: do-a
      - name: inner-a
        command: do-b
`);
    const errors = validateRoutine(routine);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Duplicate step name");
  });
});

describe("loadRoutineFile", () => {
  beforeEach(makeTestDir);
  afterEach(cleanTestDir);

  test("loads from folder-based path", () => {
    const routineDir = join(TEST_DIR, "my-routine");
    mkdirSync(routineDir, { recursive: true });
    writeFileSync(
      join(routineDir, "routine.yaml"),
      `name: my-routine\nsteps:\n  - name: s1\n    command: cmd1\n`,
    );

    const routine = loadRoutineFile("my-routine", TEST_DIR);
    expect(routine.name).toBe("my-routine");
    expect(routine.steps.length).toBe(1);
  });

  test("loads from flat file", () => {
    writeFileSync(
      join(TEST_DIR, "flat-routine.yaml"),
      `name: flat-routine\nsteps:\n  - name: s1\n    command: cmd1\n`,
    );

    const routine = loadRoutineFile("flat-routine", TEST_DIR);
    expect(routine.name).toBe("flat-routine");
  });

  test("loads from .yml extension", () => {
    writeFileSync(
      join(TEST_DIR, "yml-routine.yml"),
      `name: yml-routine\nsteps:\n  - name: s1\n    command: cmd1\n`,
    );

    const routine = loadRoutineFile("yml-routine", TEST_DIR);
    expect(routine.name).toBe("yml-routine");
  });

  test("loads from absolute path with extension", () => {
    const filePath = join(TEST_DIR, "direct.yaml");
    writeFileSync(
      filePath,
      `name: direct\nsteps:\n  - name: s1\n    command: cmd1\n`,
    );

    const routine = loadRoutineFile(filePath, TEST_DIR);
    expect(routine.name).toBe("direct");
  });

  test("throws for non-existent routine", () => {
    expect(() => loadRoutineFile("nonexistent", TEST_DIR)).toThrow("Routine not found");
  });

  test("loads from builtinsMap when provided", () => {
    const builtinsMap: Record<string, string> = {
      "builtin-test/routine.yaml": `name: builtin-test\nsteps:\n  - name: s1\n    command: cmd1\n`,
    };
    const routine = loadRoutineFile("builtin-test", TEST_DIR, builtinsMap);
    expect(routine.name).toBe("builtin-test");
  });

  test("disk routines take precedence over builtinsMap", () => {
    const routineDir = join(TEST_DIR, "my-routine");
    mkdirSync(routineDir, { recursive: true });
    writeFileSync(
      join(routineDir, "routine.yaml"),
      `name: disk-version\nsteps:\n  - name: s1\n    command: cmd1\n`,
    );
    const builtinsMap: Record<string, string> = {
      "my-routine/routine.yaml": `name: builtin-version\nsteps:\n  - name: s1\n    command: cmd1\n`,
    };
    const routine = loadRoutineFile("my-routine", TEST_DIR, builtinsMap);
    expect(routine.name).toBe("disk-version");
  });
});

describe("loadSpecFile", () => {
  beforeEach(makeTestDir);
  afterEach(cleanTestDir);

  test("loads spec file from disk", () => {
    const routineDir = join(TEST_DIR, "my-routine");
    mkdirSync(routineDir, { recursive: true });
    writeFileSync(
      join(routineDir, "spec.yaml"),
      `name: my-spec\nsteps:\n  - name: s1\n    command: cmd1\n`,
    );
    const spec = loadSpecFile("my-routine", TEST_DIR);
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe("my-spec");
  });

  test("returns null for non-existent spec", () => {
    const spec = loadSpecFile("nonexistent", TEST_DIR);
    expect(spec).toBeNull();
  });

  test("loads spec from builtinsMap", () => {
    const builtinsMap: Record<string, string> = {
      "builtin-test/spec.yaml": `name: builtin-spec\nsteps:\n  - name: s1\n    command: cmd1\n`,
    };
    const spec = loadSpecFile("builtin-test", TEST_DIR, builtinsMap);
    expect(spec).not.toBeNull();
    expect(spec!.name).toBe("builtin-spec");
  });
});

describe("listRoutines", () => {
  beforeEach(makeTestDir);
  afterEach(cleanTestDir);

  test("discovers routines", () => {
    // Folder-based
    const folderRoutine = join(TEST_DIR, "folder-routine");
    mkdirSync(folderRoutine, { recursive: true });
    writeFileSync(join(folderRoutine, "routine.yaml"), "name: folder\nsteps:\n  - name: s\n    command: c\n");

    // Flat file
    writeFileSync(join(TEST_DIR, "flat.yaml"), "name: flat\nsteps:\n  - name: s\n    command: c\n");

    const routines = listRoutines(TEST_DIR);
    expect(routines.length).toBe(2);
    // Should find both folder-based and flat routines
    const cleaned = routines.map((r) => r.replace(/\x1b\[[0-9;]*m/g, "").trim());
    expect(cleaned).toContain("folder-routine");
    expect(cleaned).toContain("flat");
  });

  test("discovers nested routines", () => {
    const nested = join(TEST_DIR, "group", "sub-routine");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "routine.yaml"), "name: sub\nsteps:\n  - name: s\n    command: c\n");

    const routines = listRoutines(TEST_DIR);
    const cleaned = routines.map((r) => r.replace(/\x1b\[[0-9;]*m/g, "").trim());
    expect(cleaned).toContain("group/sub-routine");
  });

  test("returns empty array for non-existent directory", () => {
    const routines = listRoutines(join(TEST_DIR, "nonexistent"));
    expect(routines).toEqual([]);
  });

  test("merges disk and builtin routines", () => {
    writeFileSync(join(TEST_DIR, "disk.yaml"), "name: disk\nsteps:\n  - name: s\n    command: c\n");
    const builtinsMap: Record<string, string> = {
      "builtin.yaml": `name: builtin\nsteps:\n  - name: s\n    command: c\n`,
    };
    const routines = listRoutines(TEST_DIR, builtinsMap);
    const cleaned = routines.map((r) => r.replace(/\x1b\[[0-9;]*m/g, "").trim());
    expect(cleaned).toContain("disk");
    expect(cleaned).toContain("builtin");
  });

  test("disk routines take precedence over builtins with same name", () => {
    writeFileSync(join(TEST_DIR, "shared.yaml"), "name: shared\nsteps:\n  - name: s\n    command: c\n");
    const builtinsMap: Record<string, string> = {
      "shared.yaml": `name: shared-builtin\nsteps:\n  - name: s\n    command: c\n`,
    };
    const routines = listRoutines(TEST_DIR, builtinsMap);
    const cleaned = routines.map((r) => r.replace(/\x1b\[[0-9;]*m/g, "").trim());
    // Should only appear once
    const count = cleaned.filter((r) => r === "shared").length;
    expect(count).toBe(1);
  });
});

describe("formatRoutineTree", () => {
  test("renders tree structure", () => {
    const routines = [
      "e2e/matter/create",
      "e2e/matter/delete",
      "e2e/load/upload",
      "smoke-test",
    ];
    const tree = formatRoutineTree(routines);

    // Should have tree connectors
    expect(tree).toContain("├──");
    expect(tree).toContain("└──");
    // Should contain routine names
    expect(tree).toContain("smoke-test");
    expect(tree).toContain("e2e");
    expect(tree).toContain("create");
    expect(tree).toContain("delete");
    expect(tree).toContain("upload");
  });

  test("renders single routine", () => {
    const tree = formatRoutineTree(["my-routine"]);
    expect(tree).toContain("my-routine");
    expect(tree).toContain("└──");
  });

  test("renders empty list", () => {
    const tree = formatRoutineTree([]);
    expect(tree).toBe("");
  });

  test("directories shown with trailing slash", () => {
    const routines = ["group/routine-a", "group/routine-b"];
    const tree = formatRoutineTree(routines);
    expect(tree).toContain("group/");
  });
});

describe("formatRoutineList", () => {
  test("groups directories and top-level routines", () => {
    const routines = [
      "e2e/matter/create",
      "e2e/load/upload",
      "smoke-test",
    ];
    const list = formatRoutineList(routines);
    expect(list).toContain("e2e/");
    expect(list).toContain("smoke-test");
  });
});
