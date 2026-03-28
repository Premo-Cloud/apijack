import { describe, test, expect } from 'bun:test';
import { generateTool } from './generate';
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

describe('generate tool', () => {
    test('constructs correct CLI invocation', async () => {
        const spawnCalls: unknown[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], _opts: any) => {
            spawnCalls.push(cmd);
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode('Generated files written'));
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
        const result = await generateTool.handler({}, ctx);

        expect(spawnCalls[0]).toEqual(['/usr/bin/testcli', 'generate']);
        expect(result.isError).toBeUndefined();

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });

    test('returns error result on non-zero exit code', async () => {
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (_cmd: string[], _opts: any) => {
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.close();
                    },
                }),
                stderr: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode('Something went wrong'));
                        c.close();
                    },
                }),
                exited: Promise.resolve(1),
            };
        };

        const ctx = makeCtx();
        const result = await generateTool.handler({}, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Generate failed');

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });
});
