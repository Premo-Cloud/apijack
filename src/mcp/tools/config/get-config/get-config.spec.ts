import { describe, test, expect } from 'bun:test';
import { getConfigTool } from './get-config';
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

describe('get_config tool', () => {
    test('returns config with password stripped', async () => {
        const { mkdirSync, writeFileSync, rmSync } = await import('fs');
        const { homedir } = await import('os');
        const configDir = homedir() + '/.testcli-mcp-test';
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
            configDir + '/config.json',
            JSON.stringify({
                active: 'dev',
                environments: {
                    dev: {
                        url: 'http://localhost:8080',
                        user: 'admin',
                        password: 'secret123',
                        matterId: '42',
                    },
                },
            }),
        );

        const ctx = makeCtx({ cliName: 'testcli-mcp-test' });
        const result = await getConfigTool.handler({}, ctx);

        expect(result.isError).toBeUndefined();
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.url).toBe('http://localhost:8080');
        expect(parsed.user).toBe('admin');
        expect(parsed.matterId).toBe('42');
        expect(parsed).not.toHaveProperty('password');

        // Cleanup
        rmSync(configDir, { recursive: true, force: true });
    });

    test('returns error when no config exists', async () => {
        const ctx = makeCtx({ cliName: 'nonexistent-cli-name-xyz' });
        const result = await getConfigTool.handler({}, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('No active environment');
    });
});
