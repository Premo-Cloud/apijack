#!/usr/bin/env bash
set -euo pipefail

source "$(git rev-parse --show-toplevel)/scripts/gh-pin-account.sh"

# ship.sh — Automates the dev→main shipping pipeline
# Usage: ./scripts/ship.sh
#
# Assumes:
# - You're on the dev branch with committed changes
# - gh CLI is authenticated
# - Changes have been tested locally (bun test + bun run lint)

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

info()  { echo -e "${BLUE}▸${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }

# Promote issues closed by the release PR to `deployed`. Called from both the
# published and the no-publish-needed paths — the PR is merged to main by the
# time either runs. Never aborts: the release has already landed, so a
# labelling hiccup must not leave the caller thinking the ship failed.
promote_issues() {
    info "Promoting shipped issues..."
    "$(git rev-parse --show-toplevel)/scripts/promote-shipped-issues.sh" "$PR_NUM" \
        || warn "Could not promote issue labels — release has landed; label by hand."
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

# ── Step 7: Wait for publish workflow ──────────────────────────────

info "Waiting for publish workflow..."
sleep 10  # Give GitHub time to trigger the workflow

# Find the publish run
PUBLISH_RUN=""
for i in $(seq 1 12); do
    PUBLISH_RUN=$(gh run list --branch main --workflow publish.yml --limit 1 --json databaseId,status --jq '.[0].databaseId' 2>/dev/null || true)
    if [ -n "$PUBLISH_RUN" ] && [ "$PUBLISH_RUN" != "null" ]; then
        break
    fi
    sleep 5
done

if [ -z "$PUBLISH_RUN" ] || [ "$PUBLISH_RUN" = "null" ]; then
    warn "Could not find publish workflow run."
    warn "The merge commit may have been the version bump (skipped by CI)."
    promote_issues
    info "Pulling main..."
    git checkout main --quiet && git pull --quiet
    git checkout dev --quiet && git rebase main --quiet
    ok "Done (no publish needed)"
    exit 0
fi

info "Watching publish run #$PUBLISH_RUN..."
gh run watch "$PUBLISH_RUN" --exit-status 2>/dev/null || {
    fail "Publish workflow failed!"
    echo ""
    gh run view "$PUBLISH_RUN" --log-failed 2>&1 | tail -20
    echo ""
    warn "Fix the issue on dev, then re-run this script."
    warn "Switch back: git checkout dev && git pull origin main --rebase"
    exit 1
}

ok "Published to npm"

# ── Step 8: Promote shipped issues ─────────────────────────────────

promote_issues

# ── Step 9: Cleanup ────────────────────────────────────────────────

info "Syncing branches..."
git checkout main --quiet && git pull --quiet
git checkout dev --quiet && git rebase main --quiet

ok "Shipped v$NEW_VERSION"
