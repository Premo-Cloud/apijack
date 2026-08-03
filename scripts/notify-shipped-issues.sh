#!/usr/bin/env bash
# notify-shipped-issues.sh
#
# Comment "Shipped in [<tag>](<release-url>)" on every closed issue referenced
# by commits between the previous stable tag and the one just released.
#
# WHY THIS IS A SCRIPT AND NOT A `release:`-TRIGGERED WORKFLOW: it used to be
# .github/workflows/release-notify-issues.yml, listening for `release:
# published`. But the release is created by publish.yml using
# secrets.GITHUB_TOKEN, and events authored by GITHUB_TOKEN do not trigger
# further workflow runs — so that workflow fired zero times, ever. The fix is
# to call this logic inline from publish.yml, after the release is created,
# instead of relying on an event that never arrives.
#
# Relationship to scripts/promote-shipped-issues.sh: that script applies the
# `deployed` label from `Closes #N` references in the release PR body alone.
# This script posts a comment based on the *whole* commit range between
# releases (any `#N` mention, any keyword), which catches issues referenced
# in individual commit messages that never made it into the curated PR body.
# They are complementary — running both is expected, not redundant.
#
# Usage:
#   notify-shipped-issues.sh <tag> <release-url> [--dry-run]
#
# Env:
#   REPO  — owner/repo to comment against (default: normalled/apijack)
#
# All git calls operate on the current working directory (not the git
# toplevel), so this can run from a checkout of a different repo — tests
# exercise it against a throwaway fixture repo.
#
# Never aborts the caller: a failure to comment on one issue is logged to
# stderr and the loop continues. Exits 0 unless the arguments themselves are
# invalid.

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/gh-pin-account.sh"

dry_run=0
args=()
for arg in "$@"; do
    case "$arg" in
        --dry-run)
            dry_run=1
            ;;
        -*)
            echo "usage: notify-shipped-issues.sh <tag> <release-url> [--dry-run]" >&2
            exit 1
            ;;
        *)
            args+=("$arg")
            ;;
    esac
done

# The `||` chain short-circuits, so `${args[0]}`/`${args[1]}` are never
# indexed until the length check already confirmed they exist — required
# under `set -u`, which treats an out-of-bounds array index as unbound.
if [ "${#args[@]}" -lt 2 ] || [ -z "${args[0]}" ] || [ -z "${args[1]}" ]; then
    echo "usage: notify-shipped-issues.sh <tag> <release-url> [--dry-run]" >&2
    exit 1
fi

TAG="${args[0]}"
RELEASE_URL="${args[1]}"
REPO="${REPO:-normalled/apijack}"
MARKER="Shipped in [${TAG}]("

# Captured into a variable before filtering so a `git tag` failure (not a
# repo, no tags fetched, ...) surfaces via `set -e` instead of being
# swallowed by the `|| true` below, which is scoped to "grep found nothing"
# only. Before this, a broken checkout looked identical to "no previous
# release" — both printed a friendly message and exited 0.
TAG_LIST=$(git tag --sort=-v:refname)
PREV_TAG=$(printf '%s\n' "$TAG_LIST" | { grep -v -- '-' | grep -v "^${TAG}$" | head -1 || true; })
if [ -z "$PREV_TAG" ]; then
    echo "No previous stable tag found; skipping."
    exit 0
fi
echo "Scanning $PREV_TAG..$TAG for closed-issue references"

# Same reasoning: capture `git log` first so a bad revision range (e.g. TAG
# not actually present locally) aborts loudly via `set -e` and git's own
# stderr, rather than reading as "no issue references" and exiting 0.
COMMIT_LOG=$(git log "${PREV_TAG}..${TAG}" --pretty=format:"%s %b")
NUMS=$(printf '%s' "$COMMIT_LOG" \
    | grep -oE '#[0-9]+' \
    | tr -d '#' \
    | sort -u || true)

if [ -z "$NUMS" ]; then
    echo "No issue references found."
    exit 0
fi

for N in $NUMS; do
    DATA=$(gh api "repos/${REPO}/issues/${N}" --jq '{pr: (.pull_request != null), state: .state}' 2>/dev/null || echo '{}')
    IS_PR=$(echo "$DATA" | jq -r '.pr // false')
    STATE=$(echo "$DATA" | jq -r '.state // ""')

    if [ "$IS_PR" = "true" ]; then
        echo "#${N}: pull request, skip"
        continue
    fi
    if [ "$STATE" != "closed" ]; then
        echo "#${N}: state=${STATE}, skip"
        continue
    fi

    # Idempotence guard: this script may run more than once for the same tag
    # — most plausibly a manual/local re-run while diagnosing a release, or
    # a future reordering of publish.yml's steps. A second run must not
    # double-comment, so look for the marker in any existing comment body
    # first. `per_page=100` because the default page is the oldest 30
    # comments, and the marker (if present) is more likely to be recent.
    #
    # Fails open on a transient API error (`|| echo ''`): that reads as "no
    # existing comment" and falls through to commenting again. A duplicate
    # comment is a better outcome than a silently skipped notification.
    EXISTING=$(gh api "repos/${REPO}/issues/${N}/comments?per_page=100" --jq '[.[].body] | join("\n---\n")' 2>/dev/null || echo '')
    if printf '%s' "$EXISTING" | grep -qF "$MARKER"; then
        echo "#${N}: already commented for ${TAG}, skip"
        continue
    fi

    if [ "$dry_run" -eq 1 ]; then
        echo "#${N}: [dry-run] would comment"
        continue
    fi

    echo "#${N}: commenting"
    if ! gh issue comment "$N" --repo "$REPO" \
        --body "Shipped in [${TAG}](${RELEASE_URL}) 🚀"; then
        echo "#${N}: failed to comment, continuing" >&2
    fi
done
