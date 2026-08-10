#!/usr/bin/env bash
set -euo pipefail

source "$(git rev-parse --show-toplevel)/scripts/gh-pin-account.sh"

# ship.sh — Automates the dev→main shipping pipeline
# Usage: ./scripts/ship.sh [--bump major|minor|patch]
#
# Assumes:
# - You're on the dev branch with committed changes
# - gh CLI is authenticated
# - Changes have been tested locally (bun test + bun run lint)
#
# --bump overrides the conventional-commit scan in Step 2b. It may only RAISE
# the computed level, never lower it.

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${BLUE}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }

usage() { echo "Usage: ./scripts/ship.sh [--bump major|minor|patch]"; }

# Rank bump levels so a --bump override can be compared against the scan result.
bump_rank() {
    case "$1" in
        patch) echo 0 ;;
        minor) echo 1 ;;
        major) echo 2 ;;
        *)     echo -1 ;;
    esac
}

# ── Arguments ─────────────────────────────────────────────────────
BUMP_OVERRIDE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --bump)
            if [ $# -lt 2 ]; then
                fail "--bump needs a level: major, minor, or patch."
                usage
                exit 2
            fi
            BUMP_OVERRIDE="$2"
            shift 2
            ;;
        --bump=*)
            BUMP_OVERRIDE="${1#*=}"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "Unknown argument: $1"
            usage
            exit 2
            ;;
    esac
done

case "$BUMP_OVERRIDE" in
    ""|major|minor|patch) ;;
    *)
        fail "--bump must be one of: major, minor, patch (got '$BUMP_OVERRIDE')."
        exit 2
        ;;
esac

# Promote issues closed by the release PR to `deployed`. Called from both the
# published and the no-publish-needed paths — the PR is merged to main by the
# time either runs. Never aborts: the release has already landed, so a
# labelling hiccup must not leave the caller thinking the ship failed.
promote_issues() {
    info "Promoting shipped issues..."
    "$(git rev-parse --show-toplevel)/scripts/promote-shipped-issues.sh" "$PR_NUM" \
        || warn "Could not promote issue labels — release has landed; label by hand."
}

# Resolve a merged PR's merge commit into $MERGE_SHA.
#
# `gh pr merge` returns once the REST merge completes, but `gh pr view` reads
# GraphQL, which is eventually consistent — mergeCommit is briefly null. Retry
# rather than hard-stop: past this point a bail leaves the release unpublished.
resolve_merge_sha() {
    local pr="$1" _
    MERGE_SHA=""
    for _ in $(seq 1 5); do
        MERGE_SHA=$(gh pr view "$pr" --json mergeCommit --jq '.mergeCommit.oid // empty' 2>/dev/null || true)
        [ -n "$MERGE_SHA" ] && [ "$MERGE_SHA" != "null" ] && return 0
        sleep 3
    done
    fail "Could not resolve the merge commit for PR #$pr after 5 attempts."
    warn "Re-run ./scripts/ship.sh — it will detect the untagged release and finish it."
    exit 1
}

# Tag <sha> as v<version>, push the tag, and watch the run it triggers.
#
# Tags the merge commit rather than main's tip: publish.yml resolves the
# curated release body via the tagged commit's associated PR, and only the
# merge commit maps back to the dev → main release PR.
tag_and_publish() {
    local sha="$1" version="$2"
    local tag="v$version"
    local existing run _

    # The merge commit is created server-side — fetch before tagging it.
    git fetch origin main --quiet || {
        fail "Could not fetch origin/main."
        warn "Re-run ./scripts/ship.sh — it will detect the untagged release and finish it."
        exit 1
    }

    # A tag already on origin makes the push a no-op, so publish.yml would
    # never fire and we would block for 5 minutes waiting on a phantom run.
    if [ -n "$(git ls-remote --tags origin "refs/tags/$tag" 2>/dev/null)" ]; then
        fail "Tag $tag already exists on origin — pushing it would not trigger a publish."
        warn "If $version never published, re-run publish.yml from the Actions tab."
        exit 1
    fi

    if existing=$(git rev-parse -q --verify "refs/tags/$tag^{commit}" 2>/dev/null); then
        if [ "$existing" != "$sha" ]; then
            fail "Local tag $tag points at $existing, but the release commit is $sha."
            warn "Remove the stale tag and re-run: git tag -d $tag"
            exit 1
        fi
        warn "Tag $tag already exists locally at the release commit — reusing it"
    else
        git tag -a "$tag" -m "$tag" "$sha" || {
            fail "Could not create tag $tag at $sha."
            exit 1
        }
    fi

    info "Pushing tag $tag..."
    git push origin "$tag" --quiet || {
        fail "Could not push tag $tag."
        warn "main is merged and bumped but unpublished. Recover with:"
        warn "  git push origin $tag"
        exit 1
    }
    ok "Tag $tag pushed"

    # The tag push triggers publish.yml, so a run will appear — poll only for
    # registration lag, then fail loudly rather than exiting 0 on a guess.
    info "Waiting for publish workflow..."
    run=""
    for _ in $(seq 1 30); do
        run=$(gh run list --workflow publish.yml --commit "$sha" --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
        [ -n "$run" ] && break
        sleep 10
    done

    if [ -z "$run" ]; then
        fail "No publish workflow run appeared for $tag after 300s."
        warn "The tag is pushed. Check the Actions tab and re-run publish.yml there."
        exit 1
    fi

    info "Watching publish run #$run..."
    gh run watch "$run" --exit-status 2>/dev/null || {
        fail "Publish workflow failed!"
        echo ""
        gh run view "$run" --log-failed 2>&1 | tail -20
        echo ""
        warn "The tag is pushed — fix the cause and re-run publish.yml from the Actions tab."
        warn "Switch back: git checkout dev && git pull origin main --rebase"
        exit 1
    }

    ok "Published to npm"
}

# Finish a release that was merged but never tagged.
#
# If a previous run died between `gh pr merge` and the tag push, main carries
# the bump, dev has nothing ahead of it, and nothing is published — the plain
# preflight would refuse to ship with no way forward. Detect that state and
# complete it instead. Returns without acting when nothing is stuck.
resume_untagged_release() {
    local main_version merged_pr

    git fetch origin main --tags --quiet 2>/dev/null || return 0
    main_version=$(git show origin/main:package.json 2>/dev/null | jq -r '.version // empty' 2>/dev/null || true)
    [ -n "$main_version" ] || return 0

    # Tag present (locally or on origin) means the release was armed — not stuck.
    git rev-parse -q --verify "refs/tags/v$main_version" >/dev/null 2>&1 && return 0
    [ -n "$(git ls-remote --tags origin "refs/tags/v$main_version" 2>/dev/null)" ] && return 0

    merged_pr=$(gh pr list --base main --head dev --state merged --limit 1 \
        --json number --jq '.[0].number // empty' 2>/dev/null || true)
    [ -n "$merged_pr" ] || return 0

    warn "main is at v$main_version but no v$main_version tag exists."
    warn "A previous ship merged PR #$merged_pr without tagging it — finishing that release."

    PR_NUM="$merged_pr"
    resolve_merge_sha "$PR_NUM"
    tag_and_publish "$MERGE_SHA" "$main_version"
    promote_issues

    info "Syncing branches..."
    git checkout main --quiet && git pull --quiet
    git checkout dev --quiet && git rebase main --quiet
    ok "Resumed and shipped v$main_version"
    exit 0
}

# ── Preflight ───────────────────────────────────────────────────────

BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "dev" ]; then
    fail "Must be on the dev branch (currently on: $BRANCH)"
    exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
    fail "Working tree is dirty. Commit or stash changes first."
    exit 1
fi

# Finish any half-finished ship before evaluating new work. This runs ahead of
# the COMMITS check for two reasons: it refreshes origin/main (nothing else
# does until tag_and_publish, so a run that died earlier would leave the ref
# stale and COMMITS wrongly non-zero), and a stranded untagged release must be
# recoverable even once dev has moved on. Exits 0 if it resumes; returns
# silently when nothing is stuck.
resume_untagged_release

COMMITS=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
if [ "$COMMITS" = "0" ]; then
    fail "No commits ahead of main. Nothing to ship."
    exit 1
fi

info "Shipping $COMMITS commit(s) from dev → main"

# ── Step 2b: Version bump ─────────────────────────────────────────

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -z "$LAST_TAG" ]; then
    RANGE=$(git rev-list --max-parents=0 HEAD)..HEAD
else
    RANGE="origin/main..HEAD"
fi

# Bump-level scanner: anchored to conventional-commits markers so commits that
# *describe* breaking changes in their body (e.g., a doc explaining what a gate
# refuses) don't trip the scanner. See apijack#59 for the v2.0.0 misship that
# motivated this.
#   - `BREAKING CHANGE` only counts as a footer line: `^BREAKING CHANGE:`
#   - `feat` only counts when it's the start of a commit subject: scan `%s` only
COMMIT_BODIES=$(git log "$RANGE" --pretty=format:"%b")
COMMIT_SUBJECTS=$(git log "$RANGE" --pretty=format:"%s")

if echo "$COMMIT_BODIES" | grep -qE "^BREAKING CHANGE:"; then
    BUMP_LEVEL="major"
elif echo "$COMMIT_SUBJECTS" | grep -qE "^feat[(:]"; then
    BUMP_LEVEL="minor"
else
    BUMP_LEVEL="patch"
fi

# --bump override. The scan reads commit *prefixes*, which are only a proxy for
# semver impact and can under-call it: a `fix:` commit whose fix was to add a
# new public option is a minor, not a patch (v1.16.0 / apijack#135 — the issue
# was labeled `bug`, so every commit took a `fix:` subject, while the fix itself
# added `CliOptions.refreshOn`).
#
# The override may only RAISE the level. Allowing a downgrade would let a real
# `BREAKING CHANGE:` footer ship as a patch — the mirror image of the apijack#59
# misship, and a worse failure, since under-versioning breaks consumers silently.
if [ -n "$BUMP_OVERRIDE" ]; then
    if [ "$(bump_rank "$BUMP_OVERRIDE")" -lt "$(bump_rank "$BUMP_LEVEL")" ]; then
        fail "--bump $BUMP_OVERRIDE is lower than the detected $BUMP_LEVEL bump."
        warn "The override may only raise the level. Ship $BUMP_LEVEL, or fix the commits."
        exit 1
    fi
    if [ "$BUMP_OVERRIDE" = "$BUMP_LEVEL" ]; then
        info "--bump $BUMP_OVERRIDE matches the detected level."
    else
        warn "--bump $BUMP_OVERRIDE overrides the detected $BUMP_LEVEL bump."
    fi
    BUMP_LEVEL="$BUMP_OVERRIDE"
fi

# Major-bump safeguard. The v2.0.0 misship (apijack#59) shipped a major bump
# from a commit body that documented a breaking gate without actually
# introducing one. Major bumps must be confirmed explicitly — refuse to
# proceed silently.
if [ "$BUMP_LEVEL" = "major" ]; then
    fail "Detected a MAJOR version bump."
    echo ""
    warn "Commits containing BREAKING CHANGE:"
    git log "$RANGE" --grep="BREAKING CHANGE" --pretty=format:"  %h %s"
    echo ""
    echo ""
    if [ "${SHIP_ALLOW_MAJOR:-}" = "1" ]; then
        warn "SHIP_ALLOW_MAJOR=1 set — proceeding."
    elif [ -t 0 ]; then
        read -r -p "Type 'major' to confirm, anything else aborts: " CONFIRM
        if [ "$CONFIRM" != "major" ]; then
            fail "Aborted."
            exit 1
        fi
    else
        fail "Non-interactive run. Set SHIP_ALLOW_MAJOR=1 to proceed."
        exit 1
    fi
fi

CURRENT_VERSION=$(node -p "require('./package.json').version")
npm version "$BUMP_LEVEL" --no-git-tag-version --quiet >/dev/null
NEW_VERSION=$(node -p "require('./package.json').version")

if [ "$CURRENT_VERSION" != "$NEW_VERSION" ]; then
    git add package.json
    git commit -m "chore(release): v$NEW_VERSION" --quiet
    ok "Version bump: $CURRENT_VERSION → $NEW_VERSION ($BUMP_LEVEL)"
    COMMITS=$((COMMITS + 1))
else
    warn "Version already at $CURRENT_VERSION, skipping bump"
fi

# ── Step 3: Push dev ────────────────────────────────────────────────

info "Pushing dev to origin..."
git push -u origin dev --quiet
ok "dev pushed"

# ── Step 4: Create or find PR ──────────────────────────────────────

LOCAL_HEAD=$(git rev-parse HEAD)
PR_DATA=$(gh pr list --head dev --base main --json url,headRefOid --jq '.[0]' 2>/dev/null || true)
PR_URL=$(echo "$PR_DATA" | jq -r '.url // empty' 2>/dev/null || true)
PR_HEAD=$(echo "$PR_DATA" | jq -r '.headRefOid // empty' 2>/dev/null || true)

if [ -n "$PR_URL" ] && [ "$PR_HEAD" = "$LOCAL_HEAD" ]; then
    ok "PR already exists and is up to date: $PR_URL"
elif [ -n "$PR_URL" ]; then
    ok "PR already exists (updated with new commits): $PR_URL"
else
    info "Creating PR..."

    # Build title from commits
    if [ "$COMMITS" = "1" ]; then
        PR_TITLE=$(git log origin/main..HEAD --pretty=format:"%s" | head -1)
    else
        PR_TITLE="dev → main ($COMMITS commits)"
    fi

    # Build body from commit messages
    PR_BODY=$(cat <<EOF
## Commits

$(git log origin/main..HEAD --pretty=format:"- %s")

---
Shipped via \`scripts/ship.sh\`
EOF
)

    PR_URL=$(gh pr create --base main --head dev \
        --title "$PR_TITLE" \
        --body "$PR_BODY" 2>&1)
    ok "PR created: $PR_URL"
fi

PR_NUM=$(echo "$PR_URL" | grep -oE '[0-9]+$')

# Apply `release` label idempotently. `gh pr edit --add-label` is currently
# broken by the projects-classic deprecation (exits 1), so use the REST API.
gh api -X POST "repos/normalled/apijack/issues/$PR_NUM/labels" \
    -f 'labels[]=release' >/dev/null

# ── Step 5: Wait for CI checks ─────────────────────────────────────

info "Waiting for CI checks..."
sleep 5  # Give GitHub a moment to register the checks

MAX_WAIT=300  # 5 minutes
ELAPSED=0
INTERVAL=10

while [ $ELAPSED -lt $MAX_WAIT ]; do
    STATUS=$(gh pr checks "$PR_NUM" 2>&1 || true)

    if echo "$STATUS" | grep -q "fail\|FAIL"; then
        fail "CI checks failed!"
        echo ""
        echo "$STATUS" | grep -i "fail"
        echo ""
        warn "Fix the failures, commit, push to dev, then re-run this script."
        exit 1
    fi

    if echo "$STATUS" | grep -q "pending\|PENDING\|queued\|in_progress"; then
        sleep $INTERVAL
        ELAPSED=$((ELAPSED + INTERVAL))
        continue
    fi

    # All checks passed (or no checks registered)
    if echo "$STATUS" | grep -qi "pass"; then
        break
    fi

    # No checks found yet
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
    warn "Timed out waiting for CI checks after ${MAX_WAIT}s."
    warn "Check manually: $PR_URL"
    exit 1
fi

ok "CI checks passed"

# ── Step 6: Merge PR ───────────────────────────────────────────────

info "Merging PR #$PR_NUM..."
gh pr merge "$PR_NUM" --merge --delete-branch=false --admin
ok "PR merged to main"

# ── Step 7: Tag the release ────────────────────────────────────────

# Everything below runs *after* the PR is merged, so main is already bumped.
# The tag push is the only thing that triggers publish.yml, which makes the
# merge → tag window the one place a failure leaves a release merged but
# unpublished. Two things close it: every step here reports what to do, and
# preflight's resume_untagged_release() finishes the job on a plain re-run.
resolve_merge_sha "$PR_NUM"
tag_and_publish "$MERGE_SHA" "$NEW_VERSION"

# ── Step 8: Promote shipped issues ─────────────────────────────────

promote_issues

# ── Step 9: Cleanup ────────────────────────────────────────────────

info "Syncing branches..."
git checkout main --quiet && git pull --quiet
git checkout dev --quiet && git rebase main --quiet

ok "Shipped v$NEW_VERSION"
