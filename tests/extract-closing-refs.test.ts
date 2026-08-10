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

        test('a fence nested inside a list item is recognized', async () => {
            // CommonMark measures fence indent from the enclosing list item's
            // content column, so a nested fence sits at 4+ spaces and used to
            // leak everything inside it (#134).
            const { issues } = await extract('Closes #7\n\n- outer\n  - inner\n    ```\n    Closes #100\n    ```\n');
            expect(issues).toEqual(['7']);
        });

        test('recognizes a fence at a single list item content column', async () => {
            // One level of nesting is the common shape in a PR body, and the
            // fence still opens when a blank line separates it from the marker.
            const { issues } = await extract('Closes #7\n\n- outer\n\n    ```\n    Closes #100\n    ```\n');
            expect(issues).toEqual(['7']);
        });

        test('an ordered list marker sets the content column too', async () => {
            // The content column cannot be assumed to be 2: `1. ` is three wide.
            const { issues } = await extract('1. outer\n   ```\n   Closes #100\n   ```\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('a fence marker inside an indented code block opens nothing', async () => {
            // The reason "recognize a fence at any indent" was rejected: a
            // phantom fence here would swallow every real reference after it,
            // which is the false-negative direction.
            const { issues } = await extract('Closes #7\n\n    ```\n    not a fence\n\nCloses #8\n');
            expect(issues).toEqual(['7', '8']);
        });

        test('a list marker inside an indented code block opens no container', async () => {
            // Without the indent cap on list markers, this would push a
            // container and re-enable the deep fence below it.
            const { issues } = await extract('Closes #7\n\n    - item\n      ```\n      Closes #100\n\nCloses #8\n');
            expect(issues).toEqual(['7', '8', '100']);
        });

        test('a list marker followed by 5+ spaces starts indented code, not a deeper content column', async () => {
            // CommonMark caps the content column at marker + 1 space when 5 or more
            // follow; without the cap, base lands at 6 and the fence below opens —
            // swallowing a real reference, the direction #134 exists to avoid.
            const { issues } = await extract('-     item\n      ```\n      Closes #100\n      ```\nCloses #7\n');
            expect(issues).toEqual(['7', '100']);
        });

        test('a closer indented up to three deeper than its opener still closes', async () => {
            // The lenient reading of CommonMark's closer indent rule: it closes
            // sooner, which leaves later references visible.
            const { issues } = await extract('Closes #7\n\n- outer\n  ```\n  Closes #100\n    ```\n\nCloses #8\n');
            expect(issues).toEqual(['7', '8']);
        });

        test('a deeper fence marker inside an open fence is content, not a closer', async () => {
            // 4+ past the opener is code inside the block; treating it as a
            // closer would expose the rest of the block as prose.
            const { issues } = await extract('- a\n  ```\n      ```\n  Closes #100\n  ```\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('a fence left open inside a list item ends with the list item', async () => {
            // Otherwise one unclosed nested fence hides every reference in the
            // rest of the body.
            const { issues } = await extract('- item\n  ```\n  code\n\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('a fence after the list has ended is measured from column 0 again', async () => {
            // Containers have to be popped on dedent, or the body keeps the
            // deepest content column it ever saw.
            const { issues } = await extract('- a\n  - b\n\npara\n\n    ```\n    x\n\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('a tab-indented line inside a nested fence does not end it', async () => {
            // Indent counts spaces only, so a tab read as column 0 used to dedent
            // out of the fence and leave the genuine closer to open a new one,
            // swallowing everything after it. CommonMark puts a tab at column 4.
            const { issues } = await extract('- a\n  ```\n\tcode\n  ```\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('a tab-indented line inside a nested fence does not silently reopen it', async () => {
            // The variant of the above with a real second fence: the whole body
            // shifted by one fence, exit 0, and no warning — a false negative
            // with nothing to flag it.
            const { issues, exitCode, stderr } = await extract('- a\n  ```\n\tcode\n  ```\n  Closes #7\n  ```\nCloses #8\n');
            expect(issues).toEqual(['7', '8']);
            expect(exitCode).toBe(0);
            expect(stderr).toBe('');
        });

        test('the tab exemption stops where a tab stops, at column 4', async () => {
            // A leading tab reaches column 4 and no further, so once the fence
            // sits in a container deeper than that, the line really is dedented
            // out of it and the reference is prose. Holding it inside would
            // swallow that reference silently — the defect the exemption above
            // exists to fix, just moved deeper.
            const { issues, exitCode, stderr } = await extract('- a\n  - b\n    - c\n      ```\n\tCloses #100\n      ```\nCloses #7\n');
            expect(issues).toEqual(['7', '100']);
            expect(exitCode).toBe(0);
            expect(stderr).toBe('');
        });

        test('a thematic break is not a list item', async () => {
            // `- - -` and `* * *` are rules. Pushing a container for them raises
            // the column enough for the indented code below to open as a fence.
            const dashes = await extract('- - -\n    ```\n    Closes #100\n    ```\nCloses #7\n');
            expect(dashes.issues).toEqual(['7', '100']);

            const stars = await extract('* * *\n    ```\n    Closes #100\n    ```\nCloses #7\n');
            expect(stars.issues).toEqual(['7', '100']);
        });

        test('an ordered marker longer than 9 digits is not a list item', async () => {
            // CommonMark caps ordered markers at 9 digits, so this is a
            // paragraph. Accepting it pushes a container that raises the column
            // for everything indented under it — the unsafe direction.
            const { issues } = await extract('1234567890. outer\n            ```\n            Closes #100\n            ```\nCloses #7\n');
            expect(issues).toEqual(['7', '100']);
        });

        test('a marker followed only by whitespace puts content one column past it', async () => {
            // An empty list item, per CommonMark — counting the trailing spaces
            // instead would raise the column and open the code block below.
            const { issues } = await extract('-   \n      ```\n      Closes #100\n      ```\nCloses #7\n');
            expect(issues).toEqual(['7', '100']);
        });

        test('a reference on the list-marker line itself is still printed', async () => {
            // The one new code path that runs on a line carrying a live
            // reference: it pushes a container and must still reach the print.
            const { issues } = await extract('- Closes #7\n1. Closes #8\n- [ ] Closes #9\n');
            expect(issues).toEqual(['7', '8', '9']);
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
        // Most of these leak a reference rather than hide one — the safer
        // direction. The one that can hide one is pinned last, and says so. All
        // of them are here so the behavior can't drift silently; see the header
        // comment in scripts/extract-closing-refs.sh.

        test('an indented code block is not stripped', async () => {
            // The fix models indented code (that is how a fence marker at 4+
            // spaces is made inert) but deliberately does not strip it: per #129
            // a reference is better left visible than swallowed.
            const { issues } = await extract('para\n\n    Closes #100\n');
            expect(issues).toEqual(['100']);
        });

        test('indented code inside a list item is not stripped either', async () => {
            // The case the container fix actually introduces: base is 2 here, so
            // the block starts at 6 rather than 4. Still visible, same as above.
            const { issues } = await extract('- a\n\n      Closes #100\n');
            expect(issues).toEqual(['100']);
        });

        test('a code span wrapping across a newline is not stripped', async () => {
            const { issues } = await extract('See `foo\nCloses #100` bar\n');
            expect(issues).toEqual(['100']);
        });

        test('blockquotes are not stripped', async () => {
            const { issues } = await extract('> Closes #7\n');
            expect(issues).toEqual(['7']);
        });

        test('a fence closed after an early close hides the rest — but warns', async () => {
            // Pins the MECHANISM, not a divergence. Flush-left code under a
            // bullet dedents out of the item, so the fence ends early and its
            // real closer opens a second one over the remainder. In this shape
            // CommonMark agrees the reference is code and the warning fires, so
            // nothing is actually hidden — a shape where the mechanism does
            // diverge is hard to construct, which is why this stands in for it.
            const { issues, stderr } = await extract('- Steps:\n  ```bash\nnpm install\n  ```\n\nCloses #7\n');
            expect(issues).toEqual([]);
            expect(stderr).toContain('unterminated code fence');
        });
    });

    describe('a setext underline is not a list item', () => {
        // An empty list marker on the line right after open paragraph text
        // never starts a list item (#142): for `-` it is a setext underline,
        // for `*`/`+`/ordered markers it is a lazy paragraph continuation —
        // "an empty list item cannot interrupt a paragraph". Either way no
        // container is pushed, so indented code beneath it stays indented
        // code rather than opening as a fence.
        test('leaves the indented code beneath it visible', async () => {
            const { issues, stderr, exitCode } = await extract('Title\n-\n\n    ```\n    Closes #1\n    ```\n');
            expect(issues).toEqual(['1']);
            expect(stderr).toBe('');
            expect(exitCode).toBe(0);
        });

        test('trailing whitespace on the underline does not change that', async () => {
            const { issues } = await extract('Title\n-   \n\n    ```\n    Closes #1\n    ```\n');
            expect(issues).toEqual(['1']);
        });

        test('an underline at an item content column is a heading inside the item, not a new container', async () => {
            const { issues } = await extract('- Title\n  -\n\n      Closes #100\n');
            expect(issues).toEqual(['100']);
        });

        test('a lone `-` that dedents back to sibling position is still a real empty item', async () => {
            // The one exception: dedenting to a sibling marker position pops a
            // container on the way in, which is how this case is told apart
            // from the underline above.
            const { issues } = await extract('- foo\n-\n    ```\n    Closes #100\n    ```\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('the underline closes the paragraph, so a second lone `-` is a genuine item', async () => {
            const { issues } = await extract('Title\n-\n-\n    ```\n    Closes #100\n    ```\nCloses #7\n');
            expect(issues).toEqual(['7']);
        });

        test('other empty markers cannot interrupt a paragraph either', async () => {
            const star = await extract('Title\n*\n\n    ```\n    Closes #1\n    ```\n');
            expect(star.issues).toEqual(['1']);

            const ordered = await extract('Title\n1.\n\n    ```\n    Closes #1\n    ```\n');
            expect(ordered.issues).toEqual(['1']);
        });

        test('after a closed fence a lone `-` is a genuine empty item', async () => {
            const { issues } = await extract('```\ncode\n```\n-\n    ```\n    Closes #100\n    ```\nCloses #7\n');
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
