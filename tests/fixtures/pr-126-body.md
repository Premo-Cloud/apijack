Closes #125

## Summary

Nothing in the release pipeline moved an issue to a terminal label once its code actually reached `main`. `deployed` was applied consistently through #84, then stopped — every issue from #91 onward closed still carrying `ready-for-implement` (a *triage*-state label) and, in most cases, `merged to dev`, whose own description reads "Will be closed once merged to main" and so is stale by definition the moment the release lands.

The 11 affected issues (#91, #98, #99, #100, #106, #109, #111, #115, #116, #118, #122) have been backfilled by hand. This PR is the automation so it stops recurring.

## What changes

### New `scripts/promote-shipped-issues.sh <release-pr>`

The direct counterpart to final-review's `label-merged-issues.sh`, one stage later in the pipeline — that script applies `merged to dev` at the dev-merge step; this one promotes to `deployed` after the release merges to `main`. It deliberately mirrors the sibling's structure, parse, and best-effort semantics.

Parses the release PR body for closing references, adds `deployed`, strips `ready-for-implement` and `merged to dev`. REST API for the label mutations, matching the existing workaround at `ship.sh:157` (`gh pr edit --add-label` is broken by the projects-classic deprecation).

### Wired into `ship.sh`, not the skill markdown

`ship.sh` gets a `promote_issues` helper called from **both** post-merge paths — after a successful publish, and in the `no publish needed` early-exit branch, which also runs with the PR already merged to `main`. Putting it in `ship.sh` rather than in `ship-release/SKILL.md` means `patch-deployer` inherits the behavior for free, since it shells out to the same script.

It never aborts a release: by the time it runs the code has already landed, so a labelling hiccup must not report a failed ship.

### Docs

Both `ship-release/SKILL.md` and `patch-deployer/SKILL.md` step lists updated (the latter was already stale-by-omission relative to the change).

## Acceptance criteria

- [ ] A release closing issues leaves each one labeled `deployed`, without `ready-for-implement` or `merged to dev`
- [ ] A chore-only release closing no issues is a clean no-op, exit 0
- [ ] Re-running against an already-promoted issue is idempotent
- [ ] A labelling failure does not abort a release that has already published

## Test plan

Verified against live PRs (all are idempotent re-runs against already-shipped releases):

- [x] `promote-shipped-issues.sh 124` → `+ promoted issue #122`, exit 0
- [x] `promote-shipped-issues.sh 121` → promoted #115, #116, #118, exit 0
- [x] `promote-shipped-issues.sh 114` (no closing refs) → friendly message, exit 0
- [x] Missing arg → usage error, exit 1
- [x] Failure accounting → synthetic bogus issue number yields exit 1, so `ship.sh`'s `|| warn` is reachable
- [x] `bash -n` on both scripts

Regex fixture, covering the false-positive case that motivated the leading `\b` — without it, `Discloses #15` would match and the script would strip `ready-for-implement` off an unrelated **open** issue:

```
Closes #10 / Fixed #11 / Resolved #12 / close #13 / Fixes #16   → 10 11 12 13 16   ✓
This prefixes #14 nothing / Discloses #15                       → not matched      ✓
```

## Reviewer notes

Two things worth a second look:

**The `|| true` on the issues pipeline is load-bearing.** Under `set -euo pipefail`, `grep` exiting 1 on no-match aborts the script before the friendly no-op message can run. I hit this as a live regression while testing and added it back with an accurate comment.

**The same bug exists in `label-merged-issues.sh` today** — `.claude/skills/final-review/scripts/label-merged-issues.sh 114` exits 1 silently, making its `if [ -z "$issues" ]` branch dead code. Pre-existing and out of scope here; filed separately.

