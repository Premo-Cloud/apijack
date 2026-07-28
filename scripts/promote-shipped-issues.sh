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

extract="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/extract-closing-refs.sh"

body=$(gh api "repos/$repo/pulls/$pr" --jq '.body // ""')

# Keyword matching lives in scripts/extract-closing-refs.sh, shared with
# label-merged-issues.sh and collect-closes-refs.sh. It strips fenced code
# blocks and inline code spans first — which matters most here, because this
# script doesn't only add a label, it strips `ready-for-implement`. A spurious
# match silently destroys the triage state of an open, unshipped issue.
#
# It exits 0 with no output when there are no references, so the friendly
# branch below stays reachable under `set -euo pipefail` — and non-zero on an
# internal failure, which aborts here rather than silently promoting nothing.
issues=$(printf '%s\n' "$body" | "$extract" -)

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
