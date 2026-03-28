import { describe, test, expect } from 'bun:test';
import { getRoutineTemplatesTool } from './get-routine-templates';
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

describe('get_routine_templates tool', () => {
    test('constructs correct CLI args with -o routine-step for each command', async () => {
        const spawnCalls: string[][] = [];
        const origSpawn = Bun.spawn;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (cmd: string[], _opts: unknown) => {
            spawnCalls.push(cmd);
            return {
                stdout: new ReadableStream({
                    start(c: ReadableStreamDefaultController) {
                        c.enqueue(new TextEncoder().encode('- name: create\n  command: todos create\n'));
                        c.close();
                    },
                }),
                stderr: new ReadableStream({
                    start(c: ReadableStreamDefaultController) {
                        c.close();
                    },
                }),
                exited: Promise.resolve(0),
            };
        };

        const ctx = makeCtx();
        await getRoutineTemplatesTool.handler(
            {
                commands: [
                    { command: 'todos create', args: { '--name': 'test' } },
                    { command: 'todos list' },
                ],
            },
            ctx,
        );

        expect(spawnCalls).toHaveLength(2);
        expect(spawnCalls[0]).toEqual([
            '/usr/bin/testcli',
            'todos',
            'create',
            '--name',
            'test',
            '-o',
            'routine-step',
        ]);
        expect(spawnCalls[1]).toEqual([
            '/usr/bin/testcli',
            'todos',
            'list',
            '-o',
            'routine-step',
        ]);

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });

    test('includes error comment when command fails', async () => {
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
                    c.enqueue(new TextEncoder().encode('unknown command'));
                    c.close();
                },
            }),
            exited: Promise.resolve(1),
        });

        const ctx = makeCtx();
        const result = await getRoutineTemplatesTool.handler(
            { commands: [{ command: 'nonexistent cmd' }] },
            ctx,
        );

        expect(result.content[0].text).toContain('# Error getting template for: nonexistent cmd');

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });

    test('joins multiple templates with double newline', async () => {
        const origSpawn = Bun.spawn;
        let callCount = 0;

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (_cmd: string[], _opts: unknown) => {
            callCount++;
            const output = callCount === 1 ? '- name: first' : '- name: second';
            return {
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
                exited: Promise.resolve(0),
            };
        };

        const ctx = makeCtx();
        const result = await getRoutineTemplatesTool.handler(
            {
                commands: [
                    { command: 'todos list' },
                    { command: 'todos get' },
                ],
            },
            ctx,
        );

        expect(result.content[0].text).toBe('- name: first\n\n- name: second');

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;
    });
});
