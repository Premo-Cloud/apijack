---
name: ship-release
description: Use when shipping a release from dev to main on apijack — drafts a curated release-style PR title/description (like v1.7.0), then runs scripts/ship.sh to version-bump, push, merge, and publish
---

# Ship Release

The PR that merges `dev` into `main` *is* the release notes on GitHub. `scripts/ship.sh` auto-creates a bland "dev → main (N commits)" PR if none exists — so this skill creates the curated PR first, then lets ship.sh pick it up.

## When to Use

- User says "ship", "cut a release", "release to main", or similar
- There are commits on `dev` that are not yet on `main`
- **Not** for mid-development PRs targeting `dev` (use `triage-issue` → `implement-issue` for those)

## Step 1: Preflight + gather commits

```bash
COMMITS_FILE=$(./scripts/gather-release-commits.sh)
cat "$COMMITS_FILE"
```

`gather-release-commits.sh` verifies the branch is `dev` and the working tree is clean, runs `git fetch origin`, writes `origin/main..HEAD` (default format `%h %s`) to `/tmp/apijack-ship-commits.txt`, and prints that path on stdout. It exits non-zero with a clear message on any preflight failure.

Abort and tell the user if:
- The script exits non-zero (not on `dev`, or working tree dirty)
- The output file is empty (no commits ahead of main, nothing to ship)
- An open PR already exists from `dev` → `main` with a curated body (check `gh pr list --head dev --base main`). If so, skip to step 5.

### Compute the next version

Mirror the logic in `scripts/ship.sh`. The bump-level scan needs subjects + bodies, so re-run `git log` with that format:

```bash
git log origin/main..HEAD --pretty=format:"%s%n%b"
```

- Contains `BREAKING CHANGE` → **major**
- Contains a line starting with `feat` → **minor**
- Otherwise → **patch**

Read `package.json` version and bump accordingly. Call this `NEW_VERSION`.

## Step 2: Categorize commits

Group commits from `git log origin/main..HEAD --pretty=format:"%s"` into buckets. **Skip merge commits and the `chore(release):` bump** (ship.sh adds its own).

| Bucket | Matches | PR section |
|---|---|---|
| Features | `feat(...)`, `feat: ...` | `## ✨ Features` |
| Fixes | `fix(...)`, `fix: ...` | `## 🐛 Fixes` |
| Breaking / Behavior | commits with `BREAKING CHANGE` body, or reviewer-flagged behavior changes | `## ⚠ Changed` |
| Internal | `chore:`, `docs:`, `test:`, `refactor:`, `ci:` | `## 🧹 Internal` |

For each commit, look up the PR number (often `(#NN)` in the subject, or `gh pr list --state merged --search "<commit-subject>"`) so entries read like `**Feature name** (#30) — one-sentence impact.`

**Write for humans, not for git.** A bullet should answer "what does this do for the user?" not restate the commit subject.

### Collect closing references

```bash
./scripts/collect-closes-refs.sh
```

Prints `Closes #N` lines for every issue referenced by the issue PRs merged in this range. These MUST go at the top of the release PR body (step 3) — without them, GitHub will not auto-close the issues when dev → main merges, because issue PRs merged into `dev` don't trigger closure on the non-default branch. Forward-porting the closing keywords into the release PR body is the only path that works.

If the output is empty, no issues will be auto-closed by this release — that's fine for chore-only releases that didn't resolve any tracked issues.

## Step 3: Draft the PR title and body

**Title format:** `v<NEW_VERSION>: <comma-separated highlights>`

- 2–4 highlights max, taken from the Features bucket
- Example: `v1.7.0: custom resolvers, $_find / $_contains, $_env, auth challenges`

### Concision rules — this body IS the GitHub release note

The PR body is pasted verbatim into the GitHub release. Keep it skimmable.

- **Link, don't duplicate.** Every bullet ends in `(#NN)`. The linked PR has the design, rationale, migration notes, before/after examples, and internal trade-offs. Do not restate them here.
- **One bullet per feature**, not one per export / setting / helper. If three related additions all ship together, combine them into one bullet. Every `(#37)` appearing 3 times in a row is a smell — merge.
- **Internal section is one line** — "Claude Code skills for the dev loop" beats listing every skill name. If there's nothing user-facing, drop the section entirely.
- **No surface-level tables** unless the release adds a genuinely new YAML/API surface worth an at-a-glance reference (PR #36 earned its table with 4 new routine built-ins). Single-feature releases don't need one.
- **Target length:** thesis + Features + (optional) Fixes + (optional) one-line Internal. If the body is longer than ~20 lines for a single-feature release, cut.
- **Rule of thumb:** if a reader could get the same information by clicking the `(#NN)` link, delete it.

**Body structure** (omit sections that have no entries):

```markdown
Closes #N
Closes #M
...

<1–2 sentence thesis describing the release's focus.>

## ✨ Features

- **<feature name>** (#NN) — <one-sentence user-facing impact>.
- ...

## 🐛 Fixes

- **<fix summary>** (#NN) — <what was broken, what now works>.

## ⚠ Changed

- **<what changed>** (#NN) — <who's affected, what they need to do>.

## 🧹 Internal

- <one line max, or omit the section>.

---

Shipped via `scripts/ship.sh`.
```

The trailing `Shipped via scripts/ship.sh.` line matches ship.sh's auto-generated footer — keep it.

Reference releases:
- **PR #36 (v1.7.0)** — multi-feature release; earns its table and longer sections.
- **PR #40 (v1.8.0)** — single-feature release; tight body, one combined bullet per concept, no table.

Match the density to the release, not to a template.

## Step 4: Present to the user, then create the PR

Show the drafted title and body in the chat. Ask for approval or edits before creating the PR — this is the release notes, so it's worth a human read.

Once approved:

```bash
git push -u origin dev
gh pr create --base main --head dev --title "<title>" --body "<body>"
```

Use a heredoc for the body to preserve markdown formatting.

## Step 5: Run ship.sh

```bash
./scripts/ship.sh
```

ship.sh will:
1. Bump the version (adds a `chore(release): vX.Y.Z` commit on dev and pushes) — the existing PR picks up the new commit automatically
2. Find the existing PR (won't overwrite the curated title/body)
3. Wait for CI
4. Merge via `gh pr merge --merge --admin`
5. Tag the merge commit `vX.Y.Z` and push the tag — the tag push is what triggers `publish.yml`; merging alone never publishes
6. Watch the publish workflow
7. Promote every issue closed by the release to `deployed`, stripping the now-stale `ready-for-implement` and `merged to dev` (via `scripts/promote-shipped-issues.sh`, driven by the `Closes #N` lines from step 2)
8. Sync main and rebase dev

Step 7 is why the `Closes #N` lines matter twice over: they auto-close the issues *and* drive the label promotion. A release that closes no issues is a clean no-op. Labelling never aborts a ship — the release is already published by then, so a failure only warns.

If ship.sh fails at any step, it prints what to do. Fix on dev, commit, re-run — it picks up where it left off. That includes the post-merge window: if a run dies after merging but before the tag is pushed, main is bumped but nothing is published, and a plain re-run detects the untagged release and finishes it.

## Red Flags

- **ship.sh created a `dev → main (N commits)` PR before you drafted one** → ship.sh ran first. Either update the PR title/body via `gh pr edit <num> --title ... --body ...` before the merge completes, or let it merge and edit the GitHub release afterward.
- **Title is longer than ~80 chars** → trim highlights to the 2–3 most notable.
- **Body reads like `git log` output** → rewrite bullets from the user's perspective.
- **You included the `chore(release):` commit as a bullet** → remove it; it's noise.
