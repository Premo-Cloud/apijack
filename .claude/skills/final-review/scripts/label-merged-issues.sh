#!/usr/bin/env bash
# Label every issue referenced as `Closes #N` / `Fixes #N` / `Resolves #N`
# in the PR body with `merged to dev`. Intended to run AFTER the PR has
# been merged to dev — the label marks the issue as "shipped to dev,
# pending release to main" so downstream reporting can find it.
#
# Why parse the body ourselves instead of using GitHub's
# `closingIssuesReferences` GraphQL field: that field only surfaces
# references that will auto-close on merge to the DEFAULT branch (main).
# This repo's flow merges to dev first, so the API returns empty for
# the PRs we care about here.
#
# Idempotent: re-adding an existing label is a no-op for the GitHub API.
# Non-fatal: a missing issue or per-issue failure is logged and skipped;
# the overall script exits 0. The merge already succeeded; labeling is a
# best-effort marker.
#
# Usage: label-merged-issues.sh <pr>

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
source "$repo_root/scripts/gh-pin-account.sh"

extract="$repo_root/scripts/extract-closing-refs.sh"

pr="${1:?pr number required}"
repo="normalled/apijack"
label="merged to dev"

body=$(gh api "repos/$repo/pulls/$pr" --jq '.body // ""')

# Keyword matching lives in scripts/extract-closing-refs.sh, shared with
# promote-shipped-issues.sh and collect-closes-refs.sh. It strips fenced code
# blocks and inline code spans first, so a body that merely documents the
# `Closes #N` convention doesn't get read as a reference — the failure that
# labeled five unrelated PRs during #126.
#
# It exits 0 with no output when there are no references, which keeps the
# friendly branch below reachable under `set -euo pipefail` (#127) — and
# non-zero on an internal failure, which aborts here rather than labeling nothing.
issues=$(printf '%s\n' "$body" | "$extract" -)

if [ -z "$issues" ]; then
    echo "label-merged-issues: no closing references in PR #$pr body; nothing to label."
    exit 0
fi

while IFS= read -r issue; do
    if gh api -X POST "repos/$repo/issues/$issue/labels" -f "labels[]=$label" >/dev/null 2>&1; then
        echo "  + labeled issue #$issue with '$label'"
    else
        echo "  ! failed to label issue #$issue (does it exist?)" >&2
    fi
done <<<"$issues"
