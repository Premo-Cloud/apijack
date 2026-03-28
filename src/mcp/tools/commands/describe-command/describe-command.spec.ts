import { describe, test, expect } from 'bun:test';
import { describeCommandTool } from './describe-command';
import type { McpContext } from '../../../types';

// Reuse the same fixture as list-commands
const FIXTURES_DIR = import.meta.dir + '/../list-commands/fixtures';

function makeCtx(overrides: Partial<McpContext> = {}): McpContext {
    return {
        cliName: 'testcli',
        cliInvocation: ['/usr/bin/testcli'],
        generatedDir: '/fake/generated',
        routinesDir: '/fake/routines',
        ...overrides,
    };
}

describe('describeCommandTool', () => {
    test('returns JSON info for a found command', async () => {
        const ctx = makeCtx({ generatedDir: FIXTURES_DIR });
        const result = await describeCommandTool.handler({ command: 'admin list' }, ctx);

        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.operationId).toBe('listAdmins');
        expect(parsed.description).toBe('List admins');
        expect(parsed.hasBody).toBe(false);
    });

    test('returns error when command not found', async () => {
        const ctx = makeCtx({ generatedDir: FIXTURES_DIR });
        const result = await describeCommandTool.handler({ command: 'nonexistent command' }, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Command "nonexistent command" not found');
        expect(result.content[0].text).toContain('Available commands:');
    });

    test('returns error when command map not available', async () => {
        const ctx = makeCtx({ generatedDir: '/nonexistent/path' });
        const result = await describeCommandTool.handler({ command: 'admin list' }, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Command map not available');
    });
});
