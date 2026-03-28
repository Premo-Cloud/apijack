#!/usr/bin/env bash
set -euo pipefail

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
gh pr merge "$PR_NUM" --merge --delete-branch=false
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

# ── Step 8: Cleanup ────────────────────────────────────────────────

info "Pulling version bump..."
sleep 5  # Wait for the version bump commit to land
git checkout main --quiet && git pull --quiet
git checkout dev --quiet && git pull origin main --quiet && git push

VERSION=$(node -p "require('./package.json').version")
ok "Shipped v$VERSION"
