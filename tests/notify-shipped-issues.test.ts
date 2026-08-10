import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';

const repoRoot = join(import.meta.dir, '..');
const scriptPath = join(repoRoot, 'scripts', 'notify-shipped-issues.sh');
const releaseUrl = 'https://example.com/release';

// A fake `gh` that answers only the invocations notify-shipped-issues.sh
// actually makes:
//   gh auth token --user <name>                              (gh-pin-account.sh)
//   gh api repos/<repo>/issues/<n> --jq <expr>
//   gh api repos/<repo>/issues/<n>/comments --jq <expr>
//   gh issue comment <n> --repo <repo> --body <body>
// Driven by a JSON fixture (see FixtureIssues) and recording every call it
// receives to a log file so tests can assert on what happened.
const FAKE_GH_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail

LOG="\${GH_CALL_LOG:?GH_CALL_LOG not set}"
FIXTURE="\${GH_FIXTURE:?GH_FIXTURE not set}"

case "$1" in
  auth)
    # Simulate CI: no token available for the pinned user. gh-pin-account.sh
    # treats this as a harmless no-op.
    exit 1
    ;;
  api)
    path="$2"
    jqexpr="$4"
    if [[ "$path" =~ issues/([0-9]+) ]]; then
      num="\${BASH_REMATCH[1]}"
    else
      # An unmatched call shape must fail loudly, not fall through as a
      # bare failed command: under set -e that would exit 1, which the real
      # script absorbs via \`|| echo '{}'\` and reads as "issue not found" —
      # a future test could then degrade silently instead of erroring.
      echo "fake gh: unrecognized api path: $path" >&2
      exit 2
    fi
    if [[ "$path" == *"/comments"* ]]; then
      echo "api-comments $num" >> "$LOG"
      comments=$(jq -c --arg n "$num" '.issues[$n].comments // []' "$FIXTURE")
      echo "$comments" | jq -r "$jqexpr"
    else
      echo "api-issue $num" >> "$LOG"
      issue=$(jq -c --arg n "$num" '.issues[$n] // null' "$FIXTURE")
      if [ "$issue" = "null" ]; then
        exit 1
      fi
      echo "$issue" | jq -r "$jqexpr"
    fi
    ;;
  issue)
    if [ "$2" = "comment" ]; then
      num="$3"
      body="$7"
      echo "comment $num $body" >> "$LOG"
      shouldFail=$(jq -r --arg n "$num" '(.commentFailures // []) | index($n) != null' "$FIXTURE")
      if [ "$shouldFail" = "true" ]; then
        echo "fake gh: simulated comment failure for #$num" >&2
        exit 1
      fi
      exit 0
    fi
    ;;
esac
`;

interface FixtureIssue {
    pull_request: unknown;
    state: string;
    comments?: { body: string }[];
}

interface Fixture {
    issues: Record<string, FixtureIssue>;
    commentFailures?: string[];
}

interface RunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    calls: string[];
}

function git(cwd: string, args: string[]): string {
    const res = spawnSync('git', args, { cwd, encoding: 'utf8' });

    if (res.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
    }

    return res.stdout;
}

function buildRepo(dir: string): void {
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'Test']);
}

/** Commit with a multi-line message, needed for fenced-block/inline-span fixtures. */
function commitWithMessage(dir: string, message: string): void {
    const msgFile = join(dir, '.commit-msg-tmp');
    writeFileSync(msgFile, message);
    git(dir, ['commit', '--allow-empty', '-F', msgFile]);
    rmSync(msgFile);
}

/** Run notify-shipped-issues.sh with a fake `gh` backed by `fixture`. */
async function runScript(opts: { cwd: string; args: string[]; fixture: Fixture; repo?: string }): Promise<RunResult> {
    const fakeBin = mkdtempSync(join(tmpdir(), 'notify-shipped-fakebin-'));
    const fixtureFile = join(fakeBin, 'fixture.json');
    const callLog = join(fakeBin, 'calls.log');
    writeFileSync(fixtureFile, JSON.stringify(opts.fixture));
    writeFileSync(callLog, '');
    writeFileSync(join(fakeBin, 'gh'), FAKE_GH_SCRIPT);
    chmodSync(join(fakeBin, 'gh'), 0o755);

    try {
        const proc = Bun.spawn([scriptPath, ...opts.args], {
            cwd: opts.cwd,
            stdout: 'pipe',
            stderr: 'pipe',
            env: {
                ...process.env,
                PATH: `${fakeBin}:${process.env.PATH}`,
                GH_FIXTURE: fixtureFile,
                GH_CALL_LOG: callLog,
                REPO: opts.repo ?? 'test-org/test-repo',
            },
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        const calls = readFileSync(callLog, 'utf8').split('\n').filter(Boolean);

        return { stdout, stderr, exitCode, calls };
    } finally {
        rmSync(fakeBin, { recursive: true, force: true });
    }
}

// bun test runs on windows-latest in CI, where Bun can't exec a .sh directly
// (ENOENT). This script is release automation that only ever runs from a
// maintainer's shell or Linux CI — see the identical rationale in
// tests/extract-closing-refs.test.ts.
describe.skipIf(process.platform === 'win32')('notify-shipped-issues.sh', () => {
    let mainRepo: string;
    let singleTagRepo: string;
    let noRefRepo: string;
    let crossTagRepo: string;
    let quotedRepo: string;

    // mainRepo carries commits between v1.0.0 and v1.1.0 referencing five
    // issue numbers, one per scenario the fixture drives:
    //   #10 - a pull request
    //   #11 - an open issue
    //   #12 - a closed issue with no prior comment (the happy path)
    //   #13 - a closed issue that already has a "Shipped in" comment
    //   #14 - a closed issue where posting the comment fails
    beforeAll(() => {
        mainRepo = mkdtempSync(join(tmpdir(), 'notify-shipped-main-'));
        buildRepo(mainRepo);
        git(mainRepo, ['commit', '--allow-empty', '-m', 'chore: initial commit']);
        git(mainRepo, ['tag', 'v1.0.0']);
        git(mainRepo, ['commit', '--allow-empty', '-m', 'chore: unrelated change']);
        git(mainRepo, ['commit', '--allow-empty', '-m', 'fix: pr reference Closes #10']);
        git(mainRepo, ['commit', '--allow-empty', '-m', 'fix: open issue Fixes #11']);
        git(mainRepo, ['commit', '--allow-empty', '-m', 'fix: closed issue happy path Fixes #12']);
        git(mainRepo, ['commit', '--allow-empty', '-m', 'fix: closed issue idempotent Fixes #13']);
        git(mainRepo, ['commit', '--allow-empty', '-m', 'fix: closed issue comment fails Fixes #14']);
        git(mainRepo, ['tag', 'v1.1.0']);

        singleTagRepo = mkdtempSync(join(tmpdir(), 'notify-shipped-single-'));
        buildRepo(singleTagRepo);
        git(singleTagRepo, ['commit', '--allow-empty', '-m', 'chore: initial commit']);
        git(singleTagRepo, ['tag', 'v1.0.0']);

        noRefRepo = mkdtempSync(join(tmpdir(), 'notify-shipped-noref-'));
        buildRepo(noRefRepo);
        git(noRefRepo, ['commit', '--allow-empty', '-m', 'chore: initial commit']);
        git(noRefRepo, ['tag', 'v1.0.0']);
        git(noRefRepo, ['commit', '--allow-empty', '-m', 'chore: no issue refs here']);
        git(noRefRepo, ['tag', 'v2.0.0']);

        // v1.1.0 and v1.11.0 sort as neighbors under `--sort=-v:refname`
        // (1.11.0 > 1.1.0). "Shipped in [v1.1.0](" is not a substring of
        // "Shipped in [v1.11.0](" or vice versa, so the marker check already
        // tells them apart — this test pins that property against
        // regression rather than relying on inspection alone.
        crossTagRepo = mkdtempSync(join(tmpdir(), 'notify-shipped-crosstag-'));
        buildRepo(crossTagRepo);
        git(crossTagRepo, ['commit', '--allow-empty', '-m', 'chore: initial commit']);
        git(crossTagRepo, ['tag', 'v1.1.0']);
        git(crossTagRepo, ['commit', '--allow-empty', '-m', 'fix: closed issue Fixes #20']);
        git(crossTagRepo, ['tag', 'v1.11.0']);

        // quotedRepo pins the extractor wiring: a fenced code block and an
        // inline code span each quote a `#N` that must NOT be scanned as a
        // reference, alongside genuine references (including out-of-order
        // ones) that must be — and in numeric order.
        quotedRepo = mkdtempSync(join(tmpdir(), 'notify-shipped-quoted-'));
        buildRepo(quotedRepo);
        git(quotedRepo, ['commit', '--allow-empty', '-m', 'chore: initial commit']);
        git(quotedRepo, ['tag', 'v1.0.0']);
        git(quotedRepo, ['commit', '--allow-empty', '-m', 'fix: closed issue Fixes #100']);
        git(quotedRepo, ['commit', '--allow-empty', '-m', 'fix: closed issue Fixes #11']);
        git(quotedRepo, ['commit', '--allow-empty', '-m', 'fix: closed issue Fixes #9']);
        // Fence opener as the first line of the body — only reachable via
        // `--pretty=format:"%s%n%b"`; the old "%s %b" glued it onto the
        // subject line, where the stripper's line-start fence check missed
        // it.
        commitWithMessage(quotedRepo, [
            'fix: fenced reference test',
            '',
            '```',
            'Example #77 quoted',
            '```',
            '',
            'Fixes #5',
        ].join('\n'));
        commitWithMessage(quotedRepo, [
            'fix: inline span reference test',
            '',
            'See `prefixes #14` for details',
        ].join('\n'));
        git(quotedRepo, ['tag', 'v1.1.0']);
    });

    afterAll(() => {
        for (const dir of [mainRepo, singleTagRepo, noRefRepo, crossTagRepo, quotedRepo]) {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    const mainFixture: Fixture = {
        issues: {
            10: { pull_request: { url: 'x' }, state: 'closed', comments: [] },
            11: { pull_request: null, state: 'open', comments: [] },
            12: { pull_request: null, state: 'closed', comments: [] },
            13: {
                pull_request: null,
                state: 'closed',
                comments: [{ body: `Shipped in [v1.1.0](${releaseUrl}) 🚀` }],
            },
            14: { pull_request: null, state: 'closed', comments: [] },
        },
        commentFailures: ['14'],
    };

    const quotedFixture: Fixture = {
        issues: {
            5: { pull_request: null, state: 'closed', comments: [] },
            9: { pull_request: null, state: 'closed', comments: [] },
            11: { pull_request: null, state: 'closed', comments: [] },
            100: { pull_request: null, state: 'closed', comments: [] },
        },
    };

    test('no previous stable tag: exits 0, no comments', async () => {
        const result = await runScript({
            cwd: singleTagRepo,
            args: ['v1.0.0', releaseUrl],
            fixture: { issues: {} },
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('No previous stable tag found');
        expect(result.calls.filter(c => c.startsWith('comment '))).toEqual([]);
    });

    test('no issue references in range: exits 0, no comments', async () => {
        const result = await runScript({
            cwd: noRefRepo,
            args: ['v2.0.0', releaseUrl],
            fixture: { issues: {} },
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('No issue references found');
        expect(result.calls.filter(c => c.startsWith('comment '))).toEqual([]);
    });

    test('reference that is a pull request is skipped', async () => {
        const result = await runScript({
            cwd: mainRepo,
            args: ['v1.1.0', releaseUrl],
            fixture: mainFixture,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('#10: pull request, skip');
        expect(result.calls.some(c => c.startsWith('comment 10 '))).toBe(false);
    });

    test('reference to an open issue is skipped', async () => {
        const result = await runScript({
            cwd: mainRepo,
            args: ['v1.1.0', releaseUrl],
            fixture: mainFixture,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('#11: state=open, skip');
        expect(result.calls.some(c => c.startsWith('comment 11 '))).toBe(false);
    });

    test('reference to a closed issue comments once with the exact body', async () => {
        const result = await runScript({
            cwd: mainRepo,
            args: ['v1.1.0', releaseUrl],
            fixture: mainFixture,
        });
        expect(result.exitCode).toBe(0);
        const comments12 = result.calls.filter(c => c.startsWith('comment 12 '));
        expect(comments12).toEqual([`comment 12 Shipped in [v1.1.0](${releaseUrl}) 🚀`]);
    });

    test('re-run with the marker already present does not comment again', async () => {
        const result = await runScript({
            cwd: mainRepo,
            args: ['v1.1.0', releaseUrl],
            fixture: mainFixture,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('#13: already commented for v1.1.0, skip');
        expect(result.calls.some(c => c.startsWith('comment 13 '))).toBe(false);
    });

    test('gh issue comment failing for one issue does not abort the loop', async () => {
        const result = await runScript({
            cwd: mainRepo,
            args: ['v1.1.0', releaseUrl],
            fixture: mainFixture,
        });
        // #14 is configured to fail in mainFixture.commentFailures.
        expect(result.exitCode).toBe(0);
        expect(result.calls.some(c => c.startsWith('comment 14 '))).toBe(true);
        expect(result.stderr).toContain('#14: failed to comment, continuing');
        // #12 still gets processed and commented despite #14's failure.
        expect(result.calls.some(c => c === `comment 12 Shipped in [v1.1.0](${releaseUrl}) 🚀`)).toBe(true);
    });

    test('--dry-run posts nothing', async () => {
        const result = await runScript({
            cwd: mainRepo,
            args: ['v1.1.0', releaseUrl, '--dry-run'],
            fixture: mainFixture,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('#12: [dry-run] would comment');
        expect(result.calls.filter(c => c.startsWith('comment '))).toEqual([]);
    });

    test('a marker for a different, confusable tag does not suppress the comment', async () => {
        const fixture: Fixture = {
            issues: {
                20: {
                    pull_request: null,
                    state: 'closed',
                    // Already shipped in v1.1.0 (a prior release); v1.11.0 is new.
                    comments: [{ body: `Shipped in [v1.1.0](${releaseUrl}) 🚀` }],
                },
            },
        };
        const result = await runScript({
            cwd: crossTagRepo,
            args: ['v1.11.0', releaseUrl],
            fixture,
        });
        expect(result.exitCode).toBe(0);
        expect(result.calls).toContain(`comment 20 Shipped in [v1.11.0](${releaseUrl}) 🚀`);
    });

    test('a reference quoted inside a fenced code block is not matched', async () => {
        const result = await runScript({
            cwd: quotedRepo,
            args: ['v1.1.0', releaseUrl, '--dry-run'],
            fixture: quotedFixture,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('#5: [dry-run] would comment');
        expect(result.stdout).not.toContain('#77');
    });

    test('a reference inside an inline code span is not matched', async () => {
        const result = await runScript({
            cwd: quotedRepo,
            args: ['v1.1.0', releaseUrl, '--dry-run'],
            fixture: quotedFixture,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain('#14');
    });

    test('scan order is numeric, not lexicographic', async () => {
        const result = await runScript({
            cwd: quotedRepo,
            args: ['v1.1.0', releaseUrl, '--dry-run'],
            fixture: quotedFixture,
        });
        expect(result.exitCode).toBe(0);
        const indexOf = (n: string) => result.stdout.indexOf(`#${n}: [dry-run] would comment`);
        const [i9, i11, i100] = [indexOf('9'), indexOf('11'), indexOf('100')];
        expect(i9).toBeGreaterThanOrEqual(0);
        expect(i11).toBeGreaterThan(i9);
        expect(i100).toBeGreaterThan(i11);
    });

    test('a broken revision range fails loudly instead of reading as "no issue references"', async () => {
        // v9.9.9 is not an actual tag in mainRepo: PREV_TAG resolves to
        // v1.1.0 (the highest real tag), then `git log v1.1.0..v9.9.9` fails
        // because v9.9.9 isn't a valid revision. Before the fix, the `||
        // true` around the whole git-log pipeline swallowed this and the
        // script printed "No issue references found." and exited 0.
        const result = await runScript({
            cwd: mainRepo,
            args: ['v9.9.9', releaseUrl],
            fixture: { issues: {} },
        });
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).not.toContain('No issue references found');
        expect(result.calls.filter(c => c.startsWith('comment '))).toEqual([]);
    });

    describe('usage', () => {
        // Run through runScript (fake gh on PATH) rather than a raw Bun.spawn
        // with the ambient PATH: gh-pin-account.sh runs unconditionally
        // before argument validation, so a raw spawn here would shell out to
        // the real `gh auth token --user garretpremo` against the
        // maintainer's actual keyring.
        test('errors when the tag argument is missing', async () => {
            const result = await runScript({ cwd: mainRepo, args: [], fixture: { issues: {} } });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('usage:');
        });

        test('errors when the release-url argument is missing', async () => {
            const result = await runScript({ cwd: mainRepo, args: ['v1.0.0'], fixture: { issues: {} } });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('usage:');
        });

        test('errors when the tag argument is empty', async () => {
            const result = await runScript({ cwd: mainRepo, args: ['', releaseUrl], fixture: { issues: {} } });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('usage:');
        });

        test('errors when the release-url argument is empty', async () => {
            const result = await runScript({ cwd: mainRepo, args: ['v1.16.0', ''], fixture: { issues: {} } });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('usage:');
            expect(result.calls.filter(c => c.startsWith('comment '))).toEqual([]);
        });

        test('errors on an unknown flag instead of absorbing it as a positional', async () => {
            const result = await runScript({
                cwd: mainRepo,
                args: ['--dryrun', 'v1.16.0', releaseUrl],
                fixture: { issues: {} },
            });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('usage:');
            expect(result.calls.filter(c => c.startsWith('comment '))).toEqual([]);
        });

        test('errors on a third positional argument instead of silently ignoring it', async () => {
            const result = await runScript({
                cwd: mainRepo,
                args: ['v1.0.0', releaseUrl, 'junk'],
                fixture: { issues: {} },
            });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain('usage:');
            expect(result.calls).toEqual([]);
        });
    });
});
