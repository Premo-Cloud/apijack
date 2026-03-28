import { describe, test, expect } from 'bun:test';
import { getSpecTool } from './get-spec';
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

describe('get_spec tool', () => {
    test('counts interfaces and types from types.ts', async () => {
        const ctx = makeCtx({ generatedDir: import.meta.dir + '/fixtures' });
        const result = await getSpecTool.handler({}, ctx);

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('UserDto');
        expect(result.content[0].text).toContain('MatterDto');
        expect(result.content[0].text).toContain('LoadDto');
    });

    test('returns full content in verbose mode', async () => {
        const ctx = makeCtx({ generatedDir: import.meta.dir + '/fixtures' });
        const result = await getSpecTool.handler({ verbose: true }, ctx);

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('export interface UserDto');
        expect(result.content[0].text).toContain('id: number');
    });

    test('returns error when types file not available', async () => {
        const ctx = makeCtx({ generatedDir: '/nonexistent/path' });
        const result = await getSpecTool.handler({}, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Types file not available');
    });
});
