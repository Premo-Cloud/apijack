import { describe, test, expect } from 'bun:test';
import { runRoutineTool } from './run-routine';
import type { McpContext } from '../../../types';

function makeCtx(overrides: Partial<McpContext> = {}): McpContext {
    return {
        cliName: 'testcli',
        cliInvocation: ['/usr/bin/testcli'],
        generatedDir: '/fake/generated',
        routinesDir: '/fake/routines',
        ...overrides,
    };
}

function mockSpawn(output = 'done', exitCode = 0) {
    return (_cmd: string[], _opts: unknown) => ({
        stdout: new ReadableStream({
            start(c: ReadableStreamDefaultController) {
                c.enqueue(new TextEncoder().encode(output));
                c.close();
            },
        }),
        stderr: new ReadableStream({
            start(c: ReadableStreamDefaultController) {
                c.close();
            },
        }),
        exited: Promise.resolve(exitCode),
    });
}

describe('run_routine tool', () => {
    test('constructs correct CLI args with --set flags', async () => {
        const spawnCalls: string[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], opts: unknown) => {
            spawnCalls.push(cmd);
            return mockSpawn('done')(cmd, opts);
        };

        const ctx = makeCtx();
        await runRoutineTool.handler(
            { name: 'load/quick', set: { matterId: '123', path: '/data' } },
            ctx,
        );

        expect(spawnCalls).toHaveLength(1);
        expect(spawnCalls[0]).toEqual([
            '/usr/bin/testcli',
            'routine',
            'run',
            'load/quick',
            '--set',
            'matterId=123',
            '--set',
            'path=/data',
        ]);

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });

    test('constructs args without --set when set not provided', async () => {
        const spawnCalls: string[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], opts: unknown) => {
            spawnCalls.push(cmd);
            return mockSpawn('')(cmd, opts);
        };

        const ctx = makeCtx();
        await runRoutineTool.handler({ name: 'setup/init' }, ctx);

        expect(spawnCalls[0]).toEqual([
            '/usr/bin/testcli',
            'routine',
            'run',
            'setup/init',
        ]);

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });

    test('returns error result when exit code is non-zero', async () => {
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (_cmd: string[], _opts: unknown) => ({
            stdout: new ReadableStream({
                start(c: ReadableStreamDefaultController) {
                    c.enqueue(new TextEncoder().encode(''));
                    c.close();
                },
            }),
            stderr: new ReadableStream({
                start(c: ReadableStreamDefaultController) {
                    c.enqueue(new TextEncoder().encode('routine not found'));
                    c.close();
                },
            }),
            exited: Promise.resolve(1),
        });

        const ctx = makeCtx();
        const result = await runRoutineTool.handler({ name: 'missing/routine' }, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Routine failed');

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });
});
