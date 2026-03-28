import { describe, test, expect } from 'bun:test';
import { configListTool } from './config-list';
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

describe('config_list tool', () => {
    test('constructs correct CLI invocation', async () => {
        const spawnCalls: unknown[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], _opts: any) => {
            spawnCalls.push(cmd);
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode('* dev\thttp://localhost\tadmin'));
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
        const result = await configListTool.handler({}, ctx);

        expect(spawnCalls[0]).toEqual(['/usr/bin/testcli', 'config', 'list']);
        expect(result.isError).toBeUndefined();

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });
});
