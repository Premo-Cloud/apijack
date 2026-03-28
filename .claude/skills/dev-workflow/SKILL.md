---
name: dev-workflow
description: Use for all development work on apijack — planning, implementing, testing, reviewing, and shipping changes through the dev branch with CI-gated merge to main
---

# apijack Development Workflow

All development work flows through the `dev` branch with code review and CI gates before merging to `main`.

## Workflow Overview

```
main (protected) <-- merge PR <-- dev (working branch)
```

1. **Start**: pull latest main, reset dev
2. **Loop**: plan -> implement -> test -> review (repeat until review passes)
3. **Ship**: commit, push dev, create PR, wait for CI
4. **Merge**: if CI passes, merge; if not, fix and retry
5. **Publish**: wait for publish workflow; if it fails, fix and retry

## Phase 1: Start

```bash
git checkout main && git pull
git checkout dev 2>/dev/null || git checkout -b dev
git rebase main
```

If `dev` doesn't exist yet, create it from `main`. If it does, rebase onto latest `main` to pick up any changes.

## Phase 2: Development Loop

Repeat until code review is satisfactory:

### 2a. Plan
- Understand the task requirements
- Identify which files need to change
- Consider test strategy

### 2b. Implement
- Make the code changes
- Follow existing patterns in the codebase
- Keep changes focused

### 2c. Test
- Run `bun test` — all tests must pass
- Run `bun run lint` — 0 errors (warnings are pre-existing and OK)
- Write new tests for new functionality
- Run `bun run build:plugin` if MCP server code changed

### 2d. Review
- Review the diff against main: `git diff main..HEAD`
- Check for: correctness, consistency, test coverage, backwards compatibility
- If issues found, go back to 2b

## Phases 3–7: Ship

Once review passes, commit your changes and run the ship script:

```bash
# Stage and commit
git add <changed files>
git commit -m "<conventional commit message>"

# Ship it
./scripts/ship.sh
```

The script automates the entire pipeline:

1. **Push** dev to origin
2. **Create PR** (or find existing one) to main
3. **Wait for CI** (Tests + E2E workflows) — exits with instructions if checks fail
4. **Merge** the PR
5. **Wait for publish** workflow — exits with instructions if publish fails
6. **Cleanup** — pulls version bump, rebases dev onto main

### If the script exits with a failure

The script tells you what failed and what to do. The general pattern:

1. Fix the issue on the dev branch
2. Run `bun test` and `bun run lint` locally to confirm
3. Commit the fix
4. Re-run `./scripts/ship.sh` — it picks up where it left off (finds existing PR, etc.)

### What the CI checks

Two workflows run on PRs to `main`:
- **Tests** (ci.yml): `bun test`
- **E2E** (e2e.yml): codegen against petstore, edge-cases, OAS 3.1 fixtures

### What publish does

After merge to `main`, the **Publish** workflow:
- Runs tests + lint + build
- Determines version bump from commit messages (feat = minor, fix = patch, BREAKING CHANGE = major)
- Bumps version, creates git tag, publishes to npm
- Pushes version bump commit back to main

## Commit Message Convention

Use conventional commits — the publish workflow uses these to determine version bumps:

- `feat: ...` — new feature (minor bump)
- `fix: ...` — bug fix (patch bump)
- `chore: ...` — maintenance (patch bump)
- `docs: ...` — documentation (patch bump)
- Include `BREAKING CHANGE` in the commit body for major bumps

## Key Commands Reference

| Task | Command |
|------|---------|
| Run tests | `bun test` |
| Run lint | `bun run lint` |
| Fix lint | `bun run lint:fix` |
| Build plugin | `bun run build:plugin` |
| PR checks | `gh pr checks <num> --watch` |
| View failure | `gh run view <id> --log-failed` |
| Merge PR | `gh pr merge <num> --merge` |
| Watch publish | `gh run list --branch main --limit 1` |

## Testing Plugin Changes Locally

If you changed MCP tools or skills and want to test them before shipping, use the dev-plugin script to overwrite the cached plugin:

```bash
./scripts/dev-plugin.sh            # build + overwrite cache
# Then run /reload-plugins in Claude Code

# When done testing:
./scripts/dev-plugin.sh --restore  # restore the original cache
# Then run /reload-plugins again
```

This is optional — only needed when you want to test MCP tool or skill changes interactively via Claude Code before shipping.

## Important Notes

- **Never push directly to main** — always go through dev + PR
- **Always pull main before starting** — stale branches cause merge conflicts
- **Build the plugin bundle** (`bun run build:plugin`) if you changed any file in `src/mcp-server*.ts` — the bundle is committed but gitignored, and is built during publish
- **Clear update-check hold** if testing auto-update: `rm ~/.apijack/update-check.json`
- After publish, pull main to get the version bump: `git pull` (wait ~20s after merge for CI to push it)
