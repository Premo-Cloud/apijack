import { describe, test, expect } from 'bun:test';
import { runCommandsTool } from './run-commands';
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

describe('runCommandsTool', () => {
    test('constructs correct CLI args for each command', async () => {
        const spawnCalls: unknown[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], _opts: any) => {
            spawnCalls.push(cmd);
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode('ok'));
                        c.close();
                    },
                }),
                stderr: new ReadableStream({
                    start(c) {
                        c.close();
                    },
                }),
                exited: Promise.resolve(0),
            };
        };

        const ctx = makeCtx();
        await runCommandsTool.handler({
            commands: [
                { command: 'admin users create', args: { '--name': 'test' } },
                { command: 'matters list' },
            ],
        }, ctx);

        expect(spawnCalls).toHaveLength(2);
        expect(spawnCalls[0]).toEqual([
            '/usr/bin/testcli',
            'admin',
            'users',
            'create',
            '--name',
            'test',
        ]);
        expect(spawnCalls[1]).toEqual(['/usr/bin/testcli', 'matters', 'list']);

        // @ts-expect-error - restore
        Bun.spawn = origSpawn;
    });

    test('works with single command in array', async () => {
        const spawnCalls: unknown[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], _opts: any) => {
            spawnCalls.push(cmd);
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode(''));
                        c.close();
                    },
                }),
                stderr: new ReadableStream({
                    start(c) {
                        c.close();
                    },
                }),
                exited: Promise.resolve(0),
            };
        };

        const ctx = makeCtx();
        await runCommandsTool.handler({
            commands: [{ command: 'matters list' }],
        }, ctx);

        expect(spawnCalls).toHaveLength(1);
        expect(spawnCalls[0]).toEqual(['/usr/bin/testcli', 'matters', 'list']);

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });
});
