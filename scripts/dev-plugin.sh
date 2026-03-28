#!/usr/bin/env bash
set -euo pipefail

# Overwrite the cached plugin with local dev builds for testing.
# Usage:
#   ./scripts/dev-plugin.sh              # build + overwrite cache
#   ./scripts/dev-plugin.sh --restore    # restore backup

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_DIR="$HOME/.claude/plugins/cache/local/apijack"
BACKUP_DIR="$CACHE_DIR/.dev-backup"

# Find the cached version directory (e.g. 0.4.2)
VERSION_DIR=$(find "$CACHE_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.dev-backup' | head -1)

if [[ -z "$VERSION_DIR" ]]; then
    echo "No cached plugin version found in $CACHE_DIR"
    exit 1
fi

VERSION=$(basename "$VERSION_DIR")

# ── Restore ─────────────────────────────────────────────────────────

if [[ "${1:-}" == "--restore" || "${1:-}" == "--restore-backup" ]]; then
    if [[ ! -d "$BACKUP_DIR" ]]; then
        echo "No backup found at $BACKUP_DIR"
        exit 1
    fi
    cp "$BACKUP_DIR/dist/mcp-server.bundle.js" "$VERSION_DIR/dist/mcp-server.bundle.js"
    for skill_dir in "$BACKUP_DIR/skills"/*/; do
        skill_name=$(basename "$skill_dir")
        cp "$skill_dir/SKILL.md" "$VERSION_DIR/skills/$skill_name/SKILL.md"
    done
    rm -rf "$BACKUP_DIR"
    echo "Restored plugin cache from backup (v$VERSION)"
    echo "Run /reload-plugins to pick up the restored version."
    exit 0
fi

# ── Backup + Overwrite ──────────────────────────────────────────────

# Build the MCP bundle
echo "Building MCP bundle..."
cd "$REPO_ROOT" && bun run build:plugin

# Backup current cache
mkdir -p "$BACKUP_DIR/dist" "$BACKUP_DIR/skills"
cp "$VERSION_DIR/dist/mcp-server.bundle.js" "$BACKUP_DIR/dist/mcp-server.bundle.js"
for skill_dir in "$VERSION_DIR/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    mkdir -p "$BACKUP_DIR/skills/$skill_name"
    cp "$skill_dir/SKILL.md" "$BACKUP_DIR/skills/$skill_name/SKILL.md"
done

# Overwrite with dev versions
cp "$REPO_ROOT/dist/mcp-server.bundle.js" "$VERSION_DIR/dist/mcp-server.bundle.js"
for skill_dir in "$REPO_ROOT/skills"/*/; do
    skill_name=$(basename "$skill_dir")
    if [[ -d "$VERSION_DIR/skills/$skill_name" ]]; then
        cp "$skill_dir/SKILL.md" "$VERSION_DIR/skills/$skill_name/SKILL.md"
    fi
done

echo "Overwrote plugin cache (v$VERSION) with dev builds."
echo "Run /reload-plugins, and remember to --restore-backup later!"
