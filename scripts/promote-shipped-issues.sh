#!/usr/bin/env bash
# Promote every issue referenced as `Closes #N` / `Fixes #N` / `Resolves #N`
# in a release PR body to the terminal `deployed` label, and strip the
# workflow-state labels that are stale once the code reaches main:
#
#   ready-for-implement — a triage-state label, meaningless post-ship
#   merged to dev       — its own description reads "Will be closed once
#                         merged to main", which has now happened
#
# The counterpart to final-review's label-merged-issues.sh, which applies
# `merged to dev` at the dev-merge step. This runs one stage later, from
# ship.sh after the release merges to main — so patch-deployer inherits it
# too, since it shells out to the same ship.sh.
#
# Only the curated-PR path carries `Closes #N` lines (ship-release step 2
# forward-ports them via collect-closes-refs.sh). A release PR that ship.sh
# auto-generated has none, and is a clean no-op — consistent with GitHub,
# which wouldn't auto-close those issues either.
#
# Idempotent: re-adding an existing label is a no-op for the GitHub API, and
# deleting an absent one 404s harmlessly.
#
# Usage: promote-shipped-issues.sh <release-pr>

set -euo pipefail

source "$(git rev-parse --show-toplevel)/scripts/gh-pin-account.sh"

pr="${1:?release PR number required}"
repo="normalled/apijack"
add_label="deployed"
strip_labels=("ready-for-implement" "merged to dev")

body=$(gh api "repos/$repo/pulls/$pr" --jq '.body // ""')

# Match GitHub's recognized closing keywords:
#   close / closes / closed
#   fix / fixes / fixed
#   resolve / resolves / resolved
# followed by whitespace, `#`, and a number. Case-insensitive on the keyword.
# The leading `\b` matters: without it, "discloses #15" would match and this
# script would strip `ready-for-implement` off an unrelated open issue.
#
# `|| true` is load-bearing under `set -euo pipefail`: grep exits 1 when nothing
# matches, which would abort the script on the legitimate no-closing-refs case
# before the friendly message below could run.
issues=$(printf '%s\n' "$body" \
    | grep -oiE '\b(close[sd]?|fix(es|ed)?|resolve[sd]?)[[:space:]]+#[0-9]+' \
    | grep -oE '[0-9]+' \
    | sort -un || true)

if [ -z "$issues" ]; then
    echo "promote-shipped-issues: no closing references in PR #$pr body; nothing to promote."
    exit 0
fi

# The REST API rather than `gh issue edit --add-label`: the projects-classic
# deprecation broke the edit path. Same workaround as ship.sh.
failed=0
while IFS= read -r issue; do
    if gh api -X POST "repos/$repo/issues/$issue/labels" -f "labels[]=$add_label" >/dev/null 2>&1; then
        for label in "${strip_labels[@]}"; do
            # A 404 just means the label wasn't on the issue — expected.
            gh api -X DELETE "repos/$repo/issues/$issue/labels/${label// /%20}" >/dev/null 2>&1 || true
        done
        echo "  + promoted issue #$issue to '$add_label'"
    else
        echo "  ! failed to promote issue #$issue (does it exist?)" >&2
        failed=$((failed + 1))
    fi
done <<<"$issues"

# Exit non-zero when nothing could be promoted, so ship.sh's `|| warn` is
# reachable and a total failure isn't buried in an otherwise green ship.
[ "$failed" -eq 0 ]
