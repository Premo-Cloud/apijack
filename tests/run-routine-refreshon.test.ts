import { describe, test, expect } from 'bun:test';
import { join } from 'path';

/**
 * #159 — `runRoutine()` must forward `.apijack/settings.json` `auth.refreshOn`
 * to createCli(), the same way bin/apijack.ts does.
 *
 * The assertions live in run-routine-refreshon.isolated.ts, which mocks
 * createCli to capture the options object. That mock cannot run in-process:
 * bun evaluates every test file's top level before running any test, so a
 * top-level `mock.module` poisons the shared registry for every later file
 * that imports createCli (it broke 16 tests across run-routine.test.ts and
 * custom-command-auth.test.ts). Running it as its own `bun test` process
 * contains the mock. The filename deliberately omits `.test`, so the default
 * suite does not discover it directly — only through this wrapper.
 */

const repoRoot = join(import.meta.dir, '..');

describe('#159 runRoutine forwards settings.json auth.refreshOn (isolated)', () => {
    test('isolated createCli-forwarding suite passes', async () => {
        const proc = Bun.spawn(
            [process.execPath, 'test', './tests/run-routine-refreshon.isolated.ts'],
            { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' },
        );
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        // bun test reports results on stderr; surface them when the child fails
        // so the parent failure is diagnosable without re-running by hand.
        expect(`${exitCode} ${exitCode === 0 ? '' : stderr}`.trim()).toBe('0');
        expect(stderr).toContain('3 pass');
        expect(stderr).toContain('0 fail');
    }, 30_000);
});
