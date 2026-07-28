import { describe, test, expect } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repoRoot = join(import.meta.dir, '..');
const scriptPath = join(repoRoot, 'scripts', 'extract-closing-refs.sh');
const pr126Fixture = join(import.meta.dir, 'fixtures', 'pr-126-body.md');

interface ExtractResult {
    issues: string[];
    exitCode: number;
    stderr: string;
}

/** Feed a markdown body to the extractor on stdin and collect the issue numbers. */
async function extract(body: string): Promise<ExtractResult> {
    const proc = Bun.spawn([scriptPath, '-'], {
        cwd: repoRoot,
        stdin: new TextEncoder().encode(body),
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { issues: stdout.split('\n').filter(Boolean), exitCode, stderr };
}

async function extractFile(path: string): Promise<ExtractResult> {
    const proc = Bun.spawn([scriptPath, '--body-file', path], {
        cwd: repoRoot,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    return { issues: stdout.split('\n').filter(Boolean), exitCode, stderr };
}

// `bun test` runs on windows-latest in CI, where Bun can't exec a .sh directly
// (ENOENT). The scripts under test are release automation — they run from a
// maintainer's shell and from Linux CI, never on Windows. Invoking them through
// Git Bash instead would test a configuration nobody uses, and would lean on
// MSYS's awk and coreutils rather than the ones these scripts actually run under.
describe.skipIf(process.platform === 'win32')('extract-closing-refs.sh', () => {
    describe('genuine references', () => {
        test('matches every closing keyword form GitHub honors', async () => {
            const body = [
                'Closes #1',
                'close #2',
                'closed #3',
                'Fix #4',
                'fixes #5',
                'FIXED #6',
                'resolve #7',
                'Resolves #8',
                'resolved #9',
            ].join('\n');
            const { issues, exitCode } = await extract(body);
            expect(issues).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
            expect(exitCode).toBe(0);
        });

        test('dedupes and sorts numerically', async () => {
            const { issues } = await extract('Closes #10\nFixes #10\nCloses #2\nResolves #33\n');
            expect(issues).toEqual(['2', '10', '33']);
        });

        test('matches mid-sentence and with multiple refs on one line', async () => {
            const { issues } = await extract('This one closes #4 and also fixes #5 nicely.');
            expect(issues).toEqual(['4', '5']);
        });

        test('rejects keywords that merely end in a closing keyword', async () => {
            const { issues } = await extract('Discloses #15\nprefixes #14\naffixes #13\n');
            expect(issues).toEqual([]);
        });
    });

    describe('code is not a reference', () => {
        test('ignores refs inside a backtick fenced block', async () => {
            const body = 'Closes #7\n\n```\nCloses #100\nFixes #101\n```\n';
            const { issues } = await extract(body);
            expect(issues).toEqual(['7']);
        });

        test('ignores refs inside a tilde fenced block', async () => {
            const { issues } = await extract('~~~\nCloses #100\n~~~\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('honors an info string and a longer closing fence', async () => {
            const body = '```bash\nCloses #100\n````\n\nCloses #7\n';
            const { issues } = await extract(body);
            expect(issues).toEqual(['7']);
        });

        test('honors up to three spaces of fence indent', async () => {
            const { issues } = await extract('   ```\n   Closes #100\n   ```\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('ignores refs inside a single-backtick inline span', async () => {
            const { issues } = await extract('Start the body with `Closes #100`. Closes #7\n');
            expect(issues).toEqual(['7']);
        });

        test('ignores refs inside a multi-backtick inline span', async () => {
            // The naive `\`[^\`]*\`` strip leaves the content of ``...`` behind,
            // turning a documented example back into a live reference.
            const { issues } = await extract('Write ``Closes #100`` in the body. Fixes #7\n');
            expect(issues).toEqual(['7']);
        });

        test('treats an unmatched backtick as literal text', async () => {
            const { issues } = await extract('an unpaired ` tick, closes #7\n');
            expect(issues).toEqual(['7']);
        });

        test('does not let an unterminated fence swallow the rest of the body', async () => {
            // An opening fence with no closer means everything after it is code.
            const { issues } = await extract('Closes #7\n\n```\nCloses #100\n');
            expect(issues).toEqual(['7']);
        });

        test('warns on stderr when a fence is left unterminated', async () => {
            // A closing fence cannot carry trailing text, so `\`\`\` trailing` does
            // not close — and the real ref after it is silently dropped. Correct
            // per CommonMark, but it drops references, so it must be audible.
            const { issues, stderr } = await extract('```\ncode\n``` trailing\nCloses #9\n');
            expect(issues).toEqual([]);
            expect(stderr).toContain('unterminated code fence');
        });

        test('handles CRLF bodies', async () => {
            // `gh api` returns web-authored bodies with CRLF line endings.
            const { issues } = await extract('Closes #7\r\n\r\n```\r\nCloses #100\r\n```\r\n');
            expect(issues).toEqual(['7']);
        });
    });

    describe('documented gaps', () => {
        // These leak a reference rather than hide one — the safer direction. They
        // are pinned so the behavior can't drift silently; see the header comment
        // in scripts/extract-closing-refs.sh.

        test('a fence indented 4+ spaces is not recognized', async () => {
            // Legitimate inside a nested list item. Permitting any indent would be
            // worse: an indented-code-block fence marker would open a phantom
            // fence and swallow every real reference after it.
            const { issues } = await extract('Closes #7\n\n- outer\n  - inner\n    ```\n    Closes #100\n    ```\n');
            expect(issues).toEqual(['7', '100']);
        });

        test('a code span wrapping across a newline is not stripped', async () => {
            const { issues } = await extract('See `foo\nCloses #100` bar\n');
            expect(issues).toEqual(['100']);
        });

        test('blockquotes are not stripped', async () => {
            const { issues } = await extract('> Closes #7\n');
            expect(issues).toEqual(['7']);
        });
    });

    describe('PR #126 regression', () => {
        // The incident that motivated #129: this body carries one real reference
        // plus a five-number regex fixture inside a fenced block. The old grep
        // read all six and applied `merged to dev` to five unrelated release PRs.
        test('yields only the real reference, none of the fixture numbers', async () => {
            const { issues, exitCode } = await extractFile(pr126Fixture);
            expect(issues).toEqual(['125']);
            expect(exitCode).toBe(0);

            for (const fixtureNum of ['10', '11', '12', '13', '16']) {
                expect(issues).not.toContain(fixtureNum);
            }
        });
    });

    describe('no references is not a failure', () => {
        // Regression for #127: the callers run under `set -euo pipefail`, so a
        // non-zero exit here aborts them before their "nothing to label" branch.
        test('exits 0 with no output on a body with no refs', async () => {
            const { issues, exitCode } = await extract('chore: bump deps\n\nNothing to see here.\n');
            expect(issues).toEqual([]);
            expect(exitCode).toBe(0);
        });

        test('exits 0 with no output on an empty body', async () => {
            const { issues, exitCode } = await extract('');
            expect(issues).toEqual([]);
            expect(exitCode).toBe(0);
        });

        test('exits 0 when every ref is fenced away', async () => {
            const { issues, exitCode } = await extract('```\nCloses #100\n```\n');
            expect(issues).toEqual([]);
            expect(exitCode).toBe(0);
        });
    });

    describe('usage', () => {
        test('errors on an unknown argument', async () => {
            const proc = Bun.spawn([scriptPath, '--nope'], { stdout: 'pipe', stderr: 'pipe' });
            const stderr = await new Response(proc.stderr).text();
            expect(await proc.exited).toBe(1);
            expect(stderr).toContain('usage:');
        });

        test('errors on a missing body file', async () => {
            const { exitCode, stderr } = await extractFile('/nonexistent/body.md');
            expect(exitCode).toBe(1);
            expect(stderr).toContain('body file not found');
        });

        test('reads stdin with no argument at all', async () => {
            // The third documented usage form: `cat body.md | extract-closing-refs.sh`.
            const proc = Bun.spawn([scriptPath], {
                stdin: new TextEncoder().encode('Closes #7\n'),
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const stdout = await new Response(proc.stdout).text();

            expect(await proc.exited).toBe(0);
            expect(stdout.split('\n').filter(Boolean)).toEqual(['7']);
        });
    });

    describe('internal failure is not "no references"', () => {
        // Empty-output-exit-0 is the contract for "this PR closes nothing". If an
        // internal error produced the same signal, a broken extractor would read
        // as a chore-only release and every issue in it would never auto-close.
        test('propagates a non-zero exit when the awk stage fails', async () => {
            const fakeBin = join(tmpdir(), `extract-refs-fakebin-${Date.now()}-${process.pid}`);
            mkdirSync(fakeBin, { recursive: true });
            try {
                writeFileSync(join(fakeBin, 'awk'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
                const proc = Bun.spawn([scriptPath, '-'], {
                    stdin: new TextEncoder().encode('Closes #7\n'),
                    stdout: 'pipe',
                    stderr: 'pipe',
                    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
                });
                const stdout = await new Response(proc.stdout).text();

                expect(await proc.exited).not.toBe(0);
                expect(stdout.trim()).toBe('');
            } finally {
                rmSync(fakeBin, { recursive: true, force: true });
            }
        });
    });
});
