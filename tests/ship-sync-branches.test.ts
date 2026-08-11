import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const repoRoot = join(import.meta.dir, '..');
const shipPath = join(repoRoot, 'scripts', 'ship.sh');

/**
 * #167 — ship.sh's post-release sync must push dev back to origin.
 *
 * Before the fix, sync_branches rebased local dev onto main and stopped, so
 * origin/dev kept pointing at the pre-release commit. The next
 * `git pull origin dev` refused with "divergent branches", and anything
 * branching from origin/dev started from before the release.
 *
 * sync_branches is extracted from ship.sh rather than reimplemented, so these
 * tests exercise the shipped code. Running ship.sh end-to-end is not an option
 * here — it merges PRs and publishes to npm.
 */

const HELPERS = `
set -u
info() { echo "> $1"; }
ok()   { echo "OK $1"; }
fail() { echo "FAIL $1"; }
warn() { echo "WARN $1"; }
eval "$(sed -n '/^sync_branches() {/,/^}/p' "$SHIP_PATH")"
`;

interface RunResult {
    stdout: string;
    originDev: string;
    originMain: string;
    devLog: string;
}

describe('#167 ship.sh sync_branches pushes dev to origin', () => {
    let root: string;

    /** origin.git + a clone on `dev`, with `main` one release commit ahead. */
    function setupRepos(): string {
        const work = join(root, 'work');
        const script = join(root, 'setup.sh');

        writeFileSync(script, `
set -eu
cd "${root}"
git init -q --bare origin.git
git clone -q origin.git work
cd work
git config user.email t@t
git config user.name t
echo a > f
git add f
git commit -qm init
git branch -M main
git push -q -u origin main
git checkout -qb dev
git push -q -u origin dev
git checkout -q main
echo b > f
git commit -qam "chore(release): v9.9.9"
git push -q origin main
git checkout -q dev
`);
        spawnSync('bash', [script], { encoding: 'utf-8' });

        return work;
    }

    function runSync(work: string, extra = ''): RunResult {
        const script = join(root, 'run.sh');

        writeFileSync(script, `
export SHIP_PATH="${shipPath}"
cd "${work}"
${extra}
${HELPERS}
sync_branches
echo "EXIT=$?"
git fetch -q origin
echo "ORIGIN_DEV=$(git rev-parse origin/dev)"
echo "ORIGIN_MAIN=$(git rev-parse origin/main)"
echo "DEV_LOG=$(git log origin/dev --oneline | tr '\\n' '|')"
`);
        const r = spawnSync('bash', [script], { encoding: 'utf-8' });
        const out = `${r.stdout}${r.stderr}`;
        const pick = (k: string): string => out.match(new RegExp(`${k}=(.*)`))?.[1]?.trim() ?? '';

        return {
            stdout: out,
            originDev: pick('ORIGIN_DEV'),
            originMain: pick('ORIGIN_MAIN'),
            devLog: pick('DEV_LOG'),
        };
    }

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'apijack-sync-'));
    });

    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    test('normal post-release: origin/dev is fast-forwarded to main', () => {
        const work = setupRepos();
        const r = runSync(work);

        expect(r.stdout).toContain('dev synced to origin');
        expect(r.originDev).toBe(r.originMain);
        expect(r.originDev).not.toBe('');
    });

    test('contended dev: push is rejected, never forced, and the ship still succeeds', () => {
        const work = setupRepos();

        // Someone lands work on dev during the release window, then ship.sh's
        // rebase leaves local dev at main's tip — the push cannot fast-forward.
        const intruder = `
git checkout -q dev
echo intruder > g
git add g
git commit -qm "landed during release"
git push -q origin dev
git reset -q --hard origin/main
`;
        const r = runSync(work, intruder);

        expect(r.stdout).toContain('Could not fast-forward origin/dev');
        expect(r.stdout).toContain('git pull --rebase origin dev');
        // Must not fail the ship: the release has already published by now.
        expect(r.stdout).toContain('EXIT=0');
        // The other person's commit must survive — no force-push.
        expect(r.devLog).toContain('landed during release');
        expect(r.originDev).not.toBe(r.originMain);
    });
});
