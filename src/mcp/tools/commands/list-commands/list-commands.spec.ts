import { describe, test, expect } from 'bun:test';
import { listCommandsTool } from './list-commands';
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

describe('listCommandsTool', () => {
    test('returns filtered results from command map', async () => {
        const ctx = makeCtx({ generatedDir: import.meta.dir + '/fixtures' });
        const result = await listCommandsTool.handler({ filter: 'admin' }, ctx);

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('admin list');
        expect(result.content[0].text).toContain('admin create');
        expect(result.content[0].text).not.toContain('matters');
    });

    test('returns all commands when no filter given', async () => {
        const ctx = makeCtx({ generatedDir: import.meta.dir + '/fixtures' });
        const result = await listCommandsTool.handler({}, ctx);

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('admin list');
        expect(result.content[0].text).toContain('matters list');
    });

    test('returns message when no commands match filter', async () => {
        const ctx = makeCtx({ generatedDir: import.meta.dir + '/fixtures' });
        const result = await listCommandsTool.handler({ filter: 'nonexistent' }, ctx);

        expect(result.content[0].text).toContain('No commands found matching "nonexistent"');
    });

    test('returns error when command map not available', async () => {
        const ctx = makeCtx({ generatedDir: '/nonexistent/path' });
        const result = await listCommandsTool.handler({}, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Command map not available');
    });
});
