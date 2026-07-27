---
name: patch-deployer
description: Use when origin/dev is ahead of origin/main and the cumulative bump is patch-only — drafts a curated release PR (no Features section), runs scripts/ship.sh, and reports the new release. Refuses to run for minor / major bumps; those still go through ship-release manually.
---

# Patch Deployer

Phase 5 of the apijack issue workflow, scoped to **patch releases only**. Runs the same pipeline as `ship-release` but constrained to bumps where every commit is a `fix:` / `chore:` / `docs:` / `test:` / `refactor:` / `ci:` (no `feat:`, no `BREAKING CHANGE`).

This is the "trickle out the small stuff" automation. Anything bigger keeps the human in the loop via `ship-release`.

## When to Use

- Cron tick fires
- `find-patch-deploy-candidate.sh` returns 0 (origin/dev ahead of origin/main, patch-only)

If the bump is `minor` or `major`, this skill must abort and leave the work for a human. **Do not lower the bump level to fit.**

## Steps

### 1. Verify the gate (defense-in-depth — preflight already checked)

```bash
.claude/skills/patch-deployer/scripts/find-patch-deploy-candidate.sh
```

Expected: prints the commit count, exits 0. If it exits non-zero, STOP — something changed between preflight and now (e.g., a `feat:` commit landed during the run).

### 2. Verify local working state and gather commits

```bash
COMMITS_FILE=$(./scripts/gather-release-commits.sh)
cat "$COMMITS_FILE"
```

`gather-release-commits.sh` verifies the branch is `dev` and the working tree is clean, runs `git fetch origin`, and writes `origin/main..HEAD` (default format `%h %s`) to `/tmp/apijack-ship-commits.txt`. The printed path is the canonical commit list for the rest of this skill — step 4 reads from it instead of re-running `git log`.

If the script exits non-zero, STOP. Also STOP if local HEAD ≠ origin/dev (the cron should not silently switch branches or stash user WIP).

### 3. Categorize commits

```bash
cat "$COMMITS_FILE"   # written by gather-release-commits.sh in step 2
```

Group into buckets, **skipping merge commits and any prior `chore(release):` bump**:

| Bucket | Matches | PR section |
|---|---|---|
| Fixes | `fix(...)`, `fix: ...` | `## 🐛 Fixes` |
| Internal | `chore:`, `docs:`, `test:`, `refactor:`, `ci:` | `## 🧹 Internal` |

There must be **zero** entries in a "Features" or "Changed" bucket — the gate would have rejected the run otherwise. If you find one, abort.

For each fix commit, look up the PR number (`(#NN)` in the subject, or `gh pr list --state merged --search "<subject>"`).

### 3a. Collect closing references

```bash
./scripts/collect-closes-refs.sh
```

Prints `Closes #N` lines for every issue closed by the issue PRs in this range. These MUST be placed at the top of the release PR body (step 4) — without them, GitHub will not auto-close the issues when dev → main merges, because the originating PRs landed on `dev` (a non-default branch). Empty output is fine if no tracked issues were resolved.

### 4. Draft the PR body

Use the `Write` tool — never inline in a heredoc — to avoid backtick-escaping. Write to `.claude-jobs/release-bodies/dev-to-main.md`.

#### Title format

`vX.Y.Z: <short comma-separated highlights>` — pick the 1–3 most user-visible fixes. Example: `v1.9.1: plugins-loader array filter, post-review path traversal hardening`.

#### Body template

```markdown
Closes #N
Closes #M
...

<1-sentence thesis describing the focus of the patch — usually "Bug fixes and internal cleanup since vX.Y.Z-1." or similar.>

## 🐛 Fixes

- **<fix summary>** (#NN) — <what was broken, what now works>.
- ...

## 🧹 Internal

- <one line if any non-fix commits landed; omit the section otherwise>.

---

Shipped via `scripts/ship.sh`.
```

Concision rules from `ship-release`:
- Every fix bullet ends in `(#NN)`
- One bullet per fix (combine related commits)
- Internal section is one line — `"misc CI and skill tweaks"` beats listing every chore
- If the body is longer than ~15 lines, cut

### 5. Create / update the PR

```bash
.claude/skills/patch-deployer/scripts/upsert-release-pr.sh \
    "<title>" \
    .claude-jobs/release-bodies/dev-to-main.md
```

The script edits the open `dev → main` PR if one exists, otherwise pushes `dev` and creates it. PR number is printed on stdout.

### 6. Run ship.sh

```bash
./scripts/ship.sh
```

`ship.sh` will:
1. Bump the patch version (`chore(release): vX.Y.Z` commit on dev, pushed)
2. Find the existing PR (won't overwrite the curated title/body)
3. Wait for CI
4. Merge via `gh pr merge --merge --admin`
5. Watch the publish workflow create the release + publish to npm
6. Promote every issue closed by the release to `deployed`, stripping the now-stale `ready-for-implement` and `merged to dev` (via `scripts/promote-shipped-issues.sh`, driven by the `Closes #N` lines in the PR body)
7. Sync main and rebase dev

If ship.sh exits non-zero, leave the PR in place for a human and stop.

### 7. Report

When ship.sh succeeds, report:
- New tag (`vX.Y.Z`)
- Release URL (`https://github.com/normalled/apijack/releases/tag/vX.Y.Z`)
- npm package URL

The publish workflow's release-notes pipeline (post-#54) uses the merged PR body verbatim, so the GitHub release will match what was drafted in step 4.

## Red Flags — Do Not Ship

- "There's a `feat:` commit but it's small" → STOP, it's a minor bump, hand to `ship-release`
- "Working tree is slightly dirty (untracked file)" → STOP, the user has WIP
- "CI looks like it'll pass, just merge" → STOP, ship.sh waits on CI for a reason
- "Existing PR has a body but it's bland — overwrite without asking" → edit the PR, don't `gh pr close && pr create`; preserve any reviewer comments

## Output

Either: a published patch release with the curated body shipped to GitHub + npm, or: STOP at the first failed gate without modifying anything.
