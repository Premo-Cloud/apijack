import { describe, test, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * #159 — `runRoutine()` must forward `.apijack/settings.json` `auth.refreshOn`
 * to createCli(), the same way bin/apijack.ts does.
 *
 * The refresh *wiring* below createCli is already covered by
 * cli-builder-refresh-wiring.integration.test.ts. What was missing — and what
 * let the gap ship — is a test that the programmatic entry point hands the
 * setting down at all. So this pins the forwarding, not the retry behavior:
 * createCli is mocked and we assert on the options object it receives.
 */

interface CapturedOptions {
    refreshOn?: number[];
    customCommandDefaults?: unknown;
}

let captured: CapturedOptions | undefined;

const stubCli = {
    use: () => {},
    command: () => {},
    dispatcher: () => {},
    resolver: () => {},
    runRoutine: async () => ({ status: 'ok' }),
};

// Capture the real module BEFORE mocking, and put it back in afterAll. bun's
// module registry is process-wide: without the restore, this stub leaks into
// every later file that imports createCli (it broke 16 tests across
// run-routine.test.ts and custom-command-auth.test.ts when first written).
const realCliBuilder = await import('../src/cli-builder');

mock.module('../src/cli-builder', () => ({
    ...realCliBuilder,
    createCli: (options: CapturedOptions) => {
        captured = options;

        return stubCli;
    },
}));

const { runRoutine } = await import('../src/run-routine');

afterAll(() => {
    mock.module('../src/cli-builder', () => realCliBuilder);
});

describe('#159 runRoutine forwards settings.json auth.refreshOn', () => {
    let tmpHome: string;
    let projectDir: string;
    let originalHome: string | undefined;
    let originalCwd: string;

    function writeProject(settings: unknown): void {
        mkdirSync(join(projectDir, '.apijack', 'routines'), { recursive: true });
        writeFileSync(join(projectDir, '.apijack.json'), JSON.stringify({}));
        writeFileSync(join(projectDir, '.apijack', 'config.json'), JSON.stringify({
            active: 'default',
            environments: {
                default: { url: 'http://localhost:9999', user: 'u', password: 'p' },
            },
        }));
        writeFileSync(join(projectDir, '.apijack', 'routines', 'noop.yaml'),
            'name: noop\nsteps: []\n');

        if (settings !== undefined) {
            writeFileSync(join(projectDir, '.apijack', 'settings.json'), JSON.stringify(settings));
        }
    }

    beforeEach(() => {
        captured = undefined;
        const id = `run-routine-refreshon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        tmpHome = join(tmpdir(), `${id}-home`);
        projectDir = join(tmpdir(), `${id}-project`);
        mkdirSync(join(tmpHome, '.apijack', 'routines'), { recursive: true });
        mkdirSync(projectDir, { recursive: true });

        originalHome = process.env.HOME;
        process.env.HOME = tmpHome;
        originalCwd = process.cwd();
        process.chdir(projectDir);
    });

    afterEach(() => {
        process.chdir(originalCwd);

        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;

        rmSync(tmpHome, { recursive: true, force: true });
        rmSync(projectDir, { recursive: true, force: true });
    });

    test('auth.refreshOn reaches createCli', async () => {
        writeProject({ auth: { refreshOn: [401, 403] } });

        await runRoutine('noop');

        expect(captured?.refreshOn).toEqual([401, 403]);
    });

    test('absent settings.json leaves refreshOn undefined rather than throwing', async () => {
        writeProject(undefined);

        await runRoutine('noop');

        expect(captured?.refreshOn).toBeUndefined();
    });

    test('an invalid auth.refreshOn is dropped by validation before it reaches createCli', async () => {
        writeProject({ auth: { refreshOn: 'nope' } });

        await runRoutine('noop');

        expect(captured?.refreshOn).toBeUndefined();
    });
});
