import { describe, test, expect } from 'bun:test';
import { mkdirSync, writeFileSync } from 'fs';
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
        const specDir = import.meta.dir + '/fixtures';
        mkdirSync(specDir, { recursive: true });
        writeFileSync(
            specDir + '/types.ts',
            [
                '// Auto-generated',
                'export interface UserDto {',
                '  id: number;',
                '  name: string;',
                '}',
                '',
                'export interface MatterDto {',
                '  id: number;',
                '}',
                '',
                "export type Status = 'active' | 'inactive';",
                '',
                "export type Role = 'admin' | 'user';",
                '',
                'export interface LoadDto {',
                '  loadId: number;',
                '}',
            ].join('\n'),
        );

        const ctx = makeCtx({ generatedDir: specDir });
        const result = await getSpecTool.handler({}, ctx);

        expect(result.isError).toBeUndefined();
        expect(result.content[0].text).toContain('UserDto');
        expect(result.content[0].text).toContain('MatterDto');
        expect(result.content[0].text).toContain('LoadDto');
    });

    test('returns full content in verbose mode', async () => {
        const specDir = import.meta.dir + '/fixtures';
        const ctx = makeCtx({ generatedDir: specDir });
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
