#!/usr/bin/env bash
# collect-closes-refs.sh
#
# Print deduped 'Closes #N' lines for every issue referenced by the issue PRs
# merged in the current release range. Used by ship-release and patch-deployer
# to forward-port closing keywords from per-issue PR bodies into the release PR
# body — without these lines, GitHub never auto-closes the issues when the
# release PR merges into main.
#
# Reads from /tmp/apijack-ship-commits.txt by default (the file produced by
# gather-release-commits.sh), or from $1 if provided.
#
# Output: one 'Closes #N' line per unique issue, sorted ascending. Empty if
# no closing references were found.

set -euo pipefail

COMMITS_FILE="${1:-/tmp/apijack-ship-commits.txt}"

if [ ! -f "$COMMITS_FILE" ]; then
    echo "Commits file not found: $COMMITS_FILE" >&2
    exit 1
fi

# Extract every #NN reference from commit subjects. This catches both merge
# commits ('Merge pull request #74 ...') and squash subjects ('chore: foo (#74)').
# Issue numbers that show up will fail `gh pr view` and be skipped silently.
# `|| true` on the pipeline: grep exits 1 when nothing matches, which would
# abort the script under `set -eo pipefail` — but a chore-only release with
# no referenced PRs is a legitimate empty-output case, not a failure.
PR_NUMS=$(grep -oE '#[0-9]+' "$COMMITS_FILE" | sed 's/#//' | sort -un || true)

# Resolved relative to this script rather than via `git rev-parse`, so the
# default /tmp commits-file usage still works from outside a checkout.
EXTRACT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/extract-closing-refs.sh"

# The extractor runs inside a process substitution below, whose exit status is
# never examined, inside a loop that `continue`s freely — so unlike the other
# two call sites, a missing or broken extractor here would fail SILENTLY and
# yield an empty ref list. That is indistinguishable from a chore-only release,
# and the release PR body would ship with no `Closes #N` lines at all, leaving
# every issue in the release to never auto-close. Fail loudly instead.
if [ ! -x "$EXTRACT" ]; then
    echo "collect-closes-refs: extractor missing or not executable: $EXTRACT" >&2
    exit 1
fi

declare -A SEEN
for pr in $PR_NUMS; do
    BODY=$(gh pr view "$pr" --json body --jq '.body' 2>/dev/null) || continue
    [ -z "$BODY" ] && continue
    # Shared with label-merged-issues.sh and promote-shipped-issues.sh. This
    # call site is the upstream vector for #129: whatever it pulls out of an
    # issue PR body gets written into the release PR body as `Closes #N`, which
    # promote-shipped-issues.sh then acts on. A keyword quoted in a fenced
    # example here becomes a real label mutation two steps later.
    #
    # Adopting the shared implementation also settles the drift this script had
    # against the other two: it previously matched only Closes/Fixes/Resolves
    # (missing the bare `close`/`fixed`/`resolved` forms GitHub honors) and
    # lacked the leading `\b` that rejects `Discloses #15`.
    while IFS= read -r num; do
        [ -z "$num" ] && continue
        SEEN["$num"]=1
    done < <(printf '%s\n' "$BODY" | "$EXTRACT" -)
done

for num in "${!SEEN[@]}"; do
    echo "Closes #$num"
done | sort -V
