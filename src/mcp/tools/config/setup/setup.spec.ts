import { describe, test, expect } from 'bun:test';
import { setupTool } from './setup';
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

describe('setup tool', () => {
    test('stores credentials for localhost URL and attempts generate', async () => {
        const { mkdirSync, rmSync, readFileSync } = await import('fs');
        const { homedir } = await import('os');
        const configDir = homedir() + '/.testcli-mcp-setup';
        mkdirSync(configDir, { recursive: true });

        const origSpawn = Bun.spawn;
        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (_cmd: string[], _opts: any) => {
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode('Generated'));
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

        const ctx = makeCtx({ cliName: 'testcli-mcp-setup' });
        const result = await setupTool.handler({
            name: 'dev',
            url: 'http://localhost:8080',
            user: 'admin',
            password: 'secret',
        }, ctx);

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;

        // Setup saves credentials then auto-runs generate (which fails in test — no real CLI)
        expect(result.content[0].text).toContain('dev');
        expect(result.content[0].text).toContain('configured');

        const config = JSON.parse(readFileSync(configDir + '/config.json', 'utf-8'));
        expect(config.active).toBe('dev');
        expect(config.environments.dev.url).toBe('http://localhost:8080');
        expect(config.environments.dev.password).toBe('secret');

        rmSync(configDir, { recursive: true, force: true });
    });

    test('rejects production URL', async () => {
        const ctx = makeCtx({ cliName: 'testcli-mcp-prod' });
        const result = await setupTool.handler({
            name: 'prod',
            url: 'https://api.example.com',
            user: 'admin',
            password: 'secret',
        }, ctx);

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('Production API detected');
        expect(result.content[0].text).toContain('environment variable');
    });

    test('allows IP in configured CIDRs', async () => {
        const { mkdirSync, rmSync, readFileSync } = await import('fs');
        const { homedir } = await import('os');
        const configDir = homedir() + '/.testcli-mcp-cidr';
        mkdirSync(configDir, { recursive: true });

        const origSpawn = Bun.spawn;
        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = (_cmd: string[], _opts: any) => {
            return {
                stdout: new ReadableStream({
                    start(c) {
                        c.enqueue(new TextEncoder().encode('Generated'));
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

        const ctx = makeCtx({
            cliName: 'testcli-mcp-cidr',
            allowedCidrs: ['192.168.1.0/24'],
        });
        const result = await setupTool.handler({
            name: 'internal',
            url: 'http://192.168.1.50:8080',
            user: 'admin',
            password: 'secret',
        }, ctx);

        // @ts-expect-error - mocking Bun.spawn
        Bun.spawn = origSpawn;

        // Setup saves credentials then auto-runs generate (which fails in test — no real CLI)
        expect(result.content[0].text).toContain('configured');

        const config = JSON.parse(readFileSync(configDir + '/config.json', 'utf-8'));
        expect(config.environments.internal.url).toBe('http://192.168.1.50:8080');

        rmSync(configDir, { recursive: true, force: true });
    });
});
