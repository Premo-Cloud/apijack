import { describe, test, expect } from 'bun:test';
import { configSwitchTool } from './config-switch';
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

describe('config_switch tool', () => {
    test('constructs correct CLI invocation with name arg', async () => {
        const spawnCalls: unknown[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], _opts: any) => {
            spawnCalls.push(cmd);
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode("Switched to 'staging'"));
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
        const result = await configSwitchTool.handler({ name: 'staging' }, ctx);

        expect(spawnCalls[0]).toEqual([
            '/usr/bin/testcli',
            'config',
            'switch',
            'staging',
        ]);
        expect(result.isError).toBeUndefined();

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });
});
