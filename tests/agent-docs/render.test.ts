import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  renderPackageDocs,
  renderProjectDocs,
  listRoutinesStructured,
  type ProjectContext,
} from "../../src/agent-docs/render";

const TEST_DIR = join(tmpdir(), `agent-docs-test-${Date.now()}`);

function makeTestDir() {
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanTestDir() {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
}

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

const sampleCtx: ProjectContext = {
  cliName: "myapi",
  description: "CLI for MyAPI service",
  version: "1.2.3",
  commands: [
    { path: "GET /users", operationId: "getUsers", description: "List all users", hasBody: false },
    { path: "POST /users", operationId: "createUser", description: "Create a user", hasBody: true },
    { path: "DELETE /users/{id}", operationId: "deleteUser", hasBody: false },
  ],
  routines: [
    { name: "smoke-test" },
    { name: "e2e/full-cycle", description: "End-to-end test" },
  ],
  activeEnv: { url: "https://api.example.com", user: "admin" },
};

// ─── renderPackageDocs ───────────────────────────────────────────────

describe("renderPackageDocs", () => {
  beforeEach(makeTestDir);
  afterEach(cleanTestDir);

  test("creates CLAUDE.md, AGENTS.md, GEMINI.md, skills/apijack/SKILL.md", () => {
    renderPackageDocs(TEST_DIR);

    expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "GEMINI.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "skills", "apijack", "SKILL.md"))).toBe(true);
  });

  test("CLAUDE.md contains Claude-specific content", () => {
    renderPackageDocs(TEST_DIR);
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).toContain("CLAUDE.md");
    // Should not contain Gemini-specific content
    expect(content).not.toContain("GEMINI.md convention");
    expect(content).not.toContain("activate_skill");
  });

  test("GEMINI.md contains Gemini-specific content", () => {
    renderPackageDocs(TEST_DIR);
    const content = read(join(TEST_DIR, "GEMINI.md"));

    expect(content).toContain("GEMINI.md");
    // Should not contain Claude-specific content
    expect(content).not.toContain("Claude Code skills");
  });

  test("AGENTS.md is agent-agnostic", () => {
    renderPackageDocs(TEST_DIR);
    const content = read(join(TEST_DIR, "AGENTS.md"));

    // Should not contain agent-specific content
    expect(content).not.toContain("Claude Code skills");
    expect(content).not.toContain("activate_skill");
  });

  test("all three contain core apijack content", () => {
    renderPackageDocs(TEST_DIR);

    for (const file of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) {
      const content = read(join(TEST_DIR, file));
      expect(content).toContain("apijack");
      expect(content).toContain("OpenAPI");
      expect(content).toContain("createCli");
    }
  });

  test("SKILL.md has correct frontmatter", () => {
    renderPackageDocs(TEST_DIR);
    const content = read(join(TEST_DIR, "skills", "apijack", "SKILL.md"));

    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name:");
    expect(content).toContain("apijack");
    expect(content).toContain("---");
  });
});

// ─── renderProjectDocs ──────────────────────────────────────────────

describe("renderProjectDocs", () => {
  beforeEach(makeTestDir);
  afterEach(cleanTestDir);

  test("creates 5 project-level files", () => {
    renderProjectDocs(sampleCtx, { outDir: TEST_DIR });

    expect(existsSync(join(TEST_DIR, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "GEMINI.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".claude", "skills", "myapi", "SKILL.md"))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".cursor", "rules", "apijack.md"))).toBe(true);
  });

  test("project docs include actual command inventory from context", () => {
    renderProjectDocs(sampleCtx, { outDir: TEST_DIR });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).toContain("getUsers");
    expect(content).toContain("createUser");
    expect(content).toContain("deleteUser");
    expect(content).toContain("GET /users");
    expect(content).toContain("POST /users");
  });

  test("project docs include routine list", () => {
    renderProjectDocs(sampleCtx, { outDir: TEST_DIR });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).toContain("smoke-test");
    expect(content).toContain("e2e/full-cycle");
  });

  test("project docs include cliName, description, version", () => {
    renderProjectDocs(sampleCtx, { outDir: TEST_DIR });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).toContain("myapi");
    expect(content).toContain("CLI for MyAPI service");
    expect(content).toContain("1.2.3");
  });

  test("cursor rules created at .cursor/rules/apijack.md", () => {
    renderProjectDocs(sampleCtx, { outDir: TEST_DIR });
    const content = read(join(TEST_DIR, ".cursor", "rules", "apijack.md"));

    expect(content).toContain("myapi");
    expect(content).toContain("apijack");
  });

  test("project skill created at .claude/skills/<name>/SKILL.md", () => {
    renderProjectDocs(sampleCtx, { outDir: TEST_DIR });
    const content = read(join(TEST_DIR, ".claude", "skills", "myapi", "SKILL.md"));

    expect(content).toMatch(/^---\n/);
    expect(content).toContain("myapi");
  });

  // ─── append mode ────────────────────────────────────────────────

  test("append mode: existing content outside markers preserved", () => {
    const existing = "# My Project\n\nHand-written content here.\n";
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), existing);

    renderProjectDocs(sampleCtx, { outDir: TEST_DIR, mode: "append" });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).toContain("Hand-written content here.");
    expect(content).toContain("<!-- apijack:generated:start -->");
    expect(content).toContain("<!-- apijack:generated:end -->");
    expect(content).toContain("myapi");
  });

  test("append mode: content between markers replaced", () => {
    const existing =
      "# My Project\n\n" +
      "<!-- apijack:generated:start -->\nOLD CONTENT\n<!-- apijack:generated:end -->\n\n" +
      "Hand-written footer.\n";
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), existing);

    renderProjectDocs(sampleCtx, { outDir: TEST_DIR, mode: "append" });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).not.toContain("OLD CONTENT");
    expect(content).toContain("Hand-written footer.");
    expect(content).toContain("myapi");
    expect(content).toContain("<!-- apijack:generated:start -->");
    expect(content).toContain("<!-- apijack:generated:end -->");
  });

  test("append mode: markers added to end if missing", () => {
    const existing = "# My Project\n\nSome content.\n";
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), existing);

    renderProjectDocs(sampleCtx, { outDir: TEST_DIR, mode: "append" });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).toContain("Some content.");
    expect(content).toContain("<!-- apijack:generated:start -->");
    expect(content).toContain("<!-- apijack:generated:end -->");
    // Markers should come after existing content
    const markerIdx = content.indexOf("<!-- apijack:generated:start -->");
    const existingIdx = content.indexOf("Some content.");
    expect(markerIdx).toBeGreaterThan(existingIdx);
  });

  test("append mode is default", () => {
    const existing = "# Existing\n\nPre-existing content.\n";
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), existing);

    renderProjectDocs(sampleCtx, { outDir: TEST_DIR });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).toContain("Pre-existing content.");
    expect(content).toContain("<!-- apijack:generated:start -->");
  });

  test("overwrite mode: file fully replaced", () => {
    const existing = "# Old Content\n\nThis should be gone.\n";
    writeFileSync(join(TEST_DIR, "CLAUDE.md"), existing);

    renderProjectDocs(sampleCtx, { outDir: TEST_DIR, mode: "overwrite" });
    const content = read(join(TEST_DIR, "CLAUDE.md"));

    expect(content).not.toContain("This should be gone.");
    expect(content).toContain("myapi");
  });
});

// ─── listRoutinesStructured ─────────────────────────────────────────

describe("listRoutinesStructured", () => {
  beforeEach(makeTestDir);
  afterEach(cleanTestDir);

  test("strips ANSI and returns clean names", () => {
    // Set up a routines dir with a folder-based routine that has a spec
    const routineDir = join(TEST_DIR, "my-routine");
    mkdirSync(routineDir, { recursive: true });
    writeFileSync(
      join(routineDir, "routine.yaml"),
      "name: my-routine\nsteps:\n  - name: s\n    command: c\n",
    );
    writeFileSync(
      join(routineDir, "spec.yaml"),
      "name: my-spec\nsteps:\n  - name: s\n    command: c\n",
    );

    // Also a flat file
    writeFileSync(
      join(TEST_DIR, "flat.yaml"),
      "name: flat\nsteps:\n  - name: s\n    command: c\n",
    );

    const result = listRoutinesStructured(TEST_DIR);

    // Should have two entries
    expect(result.length).toBe(2);

    // Names should be clean (no ANSI, no "(has spec)" suffix)
    const names = result.map((r) => r.name);
    expect(names).toContain("my-routine");
    expect(names).toContain("flat");

    // No ANSI codes in any name
    for (const r of result) {
      expect(r.name).not.toMatch(/\x1b/);
      expect(r.name).not.toContain("(has spec)");
    }
  });

  test("returns [] for nonexistent dir", () => {
    const result = listRoutinesStructured(join(TEST_DIR, "nonexistent"));
    expect(result).toEqual([]);
  });
});
