import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCli, type Cli } from '../src/cli-builder';
import type { CliOptions, CliContext } from '../src/types';
import type { AuthStrategy, AuthSession, SessionAuthConfig } from '../src/auth/types';
import { BasicAuthStrategy } from '../src/auth/basic';
import { generateClient } from '../src/codegen/client';
import type { OpenApiOperation } from '../src/codegen/openapi-types';

/**
 * Integration coverage for #135: `refreshOn` reachable for projects on a
 * custom AuthStrategy, at BOTH client-construction sites in cli-builder.ts —
 * the createCli/runRoutine path (~L198-260, also used for MCP tool dispatch)
 * and the run() path (~L546-661, the direct CLI invocation).
 *
 * `resolveRefreshWiring` (src/auth/refresh-wiring.ts) itself is unit-tested in
 * tests/auth/refresh-wiring.test.ts; these tests prove both cli-builder.ts
 * call sites actually route through it end-to-end with a real generated
 * ApiClient (mirrors the shape of the #77 integration test).
 */

const PATHS: Record<string, Record<string, OpenApiOperation>> = {
    '/admin/matters/{id}': {
        delete: {
            operationId: 'deleteMatter',
            parameters: [
                { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            ],
        },
    },
};

function makeCustomStrategy(): { strategy: AuthStrategy; calls: { count: number } } {
    const calls = { count: 0 };
    const strategy: AuthStrategy = {
        authenticate: async () => {
            calls.count++;

            return { headers: { Authorization: `Bearer token-${calls.count}` } } satisfies AuthSession;
        },
        restore: async cached => cached,
    };

    return { strategy, calls };
}

function writeGeneratedFixture(generatedDir: string): void {
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(join(generatedDir, 'client.ts'), generateClient(PATHS));
    // Only needs to be truthy — cli-builder gates the ApiClient import on this
    // export, but neither test drives real Commander subcommands.
    writeFileSync(join(generatedDir, 'commands.ts'), 'export function registerGeneratedCommands(): void {}\n');
    writeFileSync(
        join(generatedDir, 'command-map.ts'),
        'export const commandMap = {\n'
        + '  "admin delete": { operationId: "deleteMatter", pathParams: ["id"], queryParams: [], hasBody: false },\n'
        + '};\n',
    );
}

function writeConfig(configPath: string): void {
    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify({
        active: 'default',
        environments: {
            default: { url: 'https://api.example.com', user: 'user', password: 'pass' },
        },
    }));
}

describe('#135 refreshOn wiring for custom AuthStrategy (both cli-builder.ts call sites)', () => {
    let tmpHome: string;
    let originalFetch: typeof globalThis.fetch;
    let originalHome: string | undefined;

    beforeEach(() => {
        tmpHome = join(
            tmpdir(),
            `apijack-refreshon-custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        originalFetch = globalThis.fetch;
        originalHome = process.env.HOME;
        process.env.HOME = tmpHome;
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;

        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;

        rmSync(tmpHome, { recursive: true, force: true });
    });

    test('createCli path (runRoutine): custom strategy + options.refreshOn recovers from a stale 401 — '
        + 'authenticate() called again exactly once, request retried exactly once, no /session handshake', async () => {
        const cliConfigDir = join(tmpHome, '.testcli');
        const configPath = join(cliConfigDir, 'config.json');
        writeConfig(configPath);
        mkdirSync(join(cliConfigDir, 'routines'), { recursive: true });
        writeFileSync(
            join(cliConfigDir, 'routines', 'delete-matter.yaml'),
            'name: delete-matter\nsteps:\n  - name: delete\n    command: admin delete\n    args:\n      --id: 5\n',
        );
        const generatedDir = join(tmpHome, 'generated');
        writeGeneratedFixture(generatedDir);

        const { strategy, calls } = makeCustomStrategy();
        const deleteCalls: { authHeader: string | undefined }[] = [];
        let sessionEndpointHits = 0;

        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const urlStr = typeof url === 'string'
                ? url
                : url instanceof URL ? url.toString() : url.url;
            const headers = init?.headers as Record<string, string> | undefined;

            if (urlStr.endsWith('/session')) {
                sessionEndpointHits++;

                return new Response('{}', { status: 200 });
            }

            if (urlStr.includes('/admin/matters/5')) {
                deleteCalls.push({ authHeader: headers?.Authorization });

                if (deleteCalls.length === 1) return new Response('Unauthorized', { status: 401 });

                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }

            return new Response('not found', { status: 404 });
        }) as typeof fetch;

        const cli: Cli = createCli({
            name: 'testcli',
            description: 'test',
            version: '1.0.0',
            specPath: '/v3/api-docs',
            auth: strategy,
            refreshOn: [401],
            generatedDir,
            configPath,
        });

        const result = await cli.runRoutine('delete-matter');

        expect(result.status).toBe('ok');
        expect(sessionEndpointHits).toBe(0); // no double /session handshake — not wrapped in SessionAuthStrategy
        expect(calls.count).toBe(2); // initial authenticate() + exactly one refresh
        expect(deleteCalls).toHaveLength(2);
        expect(deleteCalls[0]!.authHeader).toBe('Bearer token-1');
        expect(deleteCalls[1]!.authHeader).toBe('Bearer token-2');
    });

    test('createCli path (runRoutine): retried request also fails — one-retry cap holds, original error propagates', async () => {
        const cliConfigDir = join(tmpHome, '.testcli');
        const configPath = join(cliConfigDir, 'config.json');
        writeConfig(configPath);
        mkdirSync(join(cliConfigDir, 'routines'), { recursive: true });
        writeFileSync(
            join(cliConfigDir, 'routines', 'delete-matter.yaml'),
            'name: delete-matter\nsteps:\n  - name: delete\n    command: admin delete\n    args:\n      --id: 5\n',
        );
        const generatedDir = join(tmpHome, 'generated');
        writeGeneratedFixture(generatedDir);

        const { strategy, calls } = makeCustomStrategy();
        let deleteCount = 0;

        globalThis.fetch = (async (url: string | URL | Request) => {
            const urlStr = typeof url === 'string'
                ? url
                : url instanceof URL ? url.toString() : url.url;

            if (urlStr.includes('/admin/matters/5')) {
                deleteCount++;

                return new Response('Unauthorized', { status: 401 });
            }

            return new Response('not found', { status: 404 });
        }) as typeof fetch;

        const cli: Cli = createCli({
            name: 'testcli',
            description: 'test',
            version: '1.0.0',
            specPath: '/v3/api-docs',
            auth: strategy,
            refreshOn: [401],
            generatedDir,
            configPath,
        });

        const result = await cli.runRoutine('delete-matter');

        expect(result.status).not.toBe('ok');
        expect(deleteCount).toBe(2); // initial + exactly one retry, no further attempts
        expect(calls.count).toBe(2); // initial authenticate() + exactly one refresh attempt
    });

    test('createCli path (runRoutine): sessionAuth.refreshOn fallback still works when options.refreshOn is unset (#77 regression)', async () => {
        const cliConfigDir = join(tmpHome, '.testcli');
        const configPath = join(cliConfigDir, 'config.json');
        writeConfig(configPath);
        mkdirSync(join(cliConfigDir, 'routines'), { recursive: true });
        writeFileSync(
            join(cliConfigDir, 'routines', 'delete-matter.yaml'),
            'name: delete-matter\nsteps:\n  - name: delete\n    command: admin delete\n    args:\n      --id: 5\n',
        );
        const generatedDir = join(tmpHome, 'generated');
        writeGeneratedFixture(generatedDir);

        const sessionAuth: SessionAuthConfig = {
            session: { endpoint: '/session' },
            cookies: { extract: ['SESSION'], applyTo: ['DELETE'] },
            refreshOn: [401],
        };

        let sessionCount = 0;
        const deletes: { cookieHeader: string | undefined }[] = [];

        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const urlStr = typeof url === 'string'
                ? url
                : url instanceof URL ? url.toString() : url.url;
            const headers = init?.headers as Record<string, string> | undefined;

            if (urlStr.endsWith('/session')) {
                sessionCount++;

                return new Response('{}', {
                    status: 200,
                    headers: [['Set-Cookie', `SESSION=fresh-${sessionCount}; Path=/`]],
                });
            }

            if (urlStr.includes('/admin/matters/5')) {
                deletes.push({ cookieHeader: headers?.Cookie });

                if (deletes.length === 1) return new Response('Unauthorized', { status: 401 });

                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }

            return new Response('not found', { status: 404 });
        }) as typeof fetch;

        const cli: Cli = createCli({
            name: 'testcli',
            description: 'test',
            version: '1.0.0',
            specPath: '/v3/api-docs',
            auth: new BasicAuthStrategy(),
            sessionAuth,
            generatedDir,
            configPath,
        });

        const result = await cli.runRoutine('delete-matter');

        expect(result.status).toBe('ok');
        // No cached session pre-populated here (unlike #77's test), so the initial
        // authenticate() also hits /session — plus exactly one refresh handshake.
        expect(sessionCount).toBe(2);
        expect(deletes).toHaveLength(2);
        expect(deletes[0]!.cookieHeader).toContain('SESSION=fresh-1');
        expect(deletes[1]!.cookieHeader).toContain('SESSION=fresh-2');
    });

    test('createCli path (runRoutine): options.refreshOn takes precedence over sessionAuth.refreshOn', async () => {
        const cliConfigDir = join(tmpHome, '.testcli');
        const configPath = join(cliConfigDir, 'config.json');
        writeConfig(configPath);
        mkdirSync(join(cliConfigDir, 'routines'), { recursive: true });
        writeFileSync(
            join(cliConfigDir, 'routines', 'delete-matter.yaml'),
            'name: delete-matter\nsteps:\n  - name: delete\n    command: admin delete\n    args:\n      --id: 5\n',
        );
        const generatedDir = join(tmpHome, 'generated');
        writeGeneratedFixture(generatedDir);

        // sessionAuth.refreshOn only covers 500 — if the fallback were used, a
        // 401 would NOT trigger a refresh. options.refreshOn = [401] must win.
        const sessionAuth: SessionAuthConfig = {
            session: { endpoint: '/session' },
            cookies: { extract: ['SESSION'], applyTo: ['DELETE'] },
            refreshOn: [500],
        };

        let sessionCount = 0;
        let deleteCount = 0;

        globalThis.fetch = (async (url: string | URL | Request) => {
            const urlStr = typeof url === 'string'
                ? url
                : url instanceof URL ? url.toString() : url.url;

            if (urlStr.endsWith('/session')) {
                sessionCount++;

                return new Response('{}', {
                    status: 200,
                    headers: [['Set-Cookie', `SESSION=fresh-${sessionCount}; Path=/`]],
                });
            }

            if (urlStr.includes('/admin/matters/5')) {
                deleteCount++;

                if (deleteCount === 1) return new Response('Unauthorized', { status: 401 });

                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }

            return new Response('not found', { status: 404 });
        }) as typeof fetch;

        const cli: Cli = createCli({
            name: 'testcli',
            description: 'test',
            version: '1.0.0',
            specPath: '/v3/api-docs',
            auth: new BasicAuthStrategy(),
            sessionAuth,
            refreshOn: [401],
            generatedDir,
            configPath,
        });

        const result = await cli.runRoutine('delete-matter');

        expect(result.status).toBe('ok');
        expect(deleteCount).toBe(2);
        // No cached session pre-populated here, so the initial authenticate()
        // also hits /session — plus exactly one refresh handshake.
        expect(sessionCount).toBe(2);
    });

    test('run() path: custom strategy + options.refreshOn recovers from a stale 401 via the same wiring as the createCli path', async () => {
        const cliConfigDir = join(tmpHome, '.testcli');
        const configPath = join(cliConfigDir, 'config.json');
        writeConfig(configPath);
        const generatedDir = join(tmpHome, 'generated');
        writeGeneratedFixture(generatedDir);

        const { strategy, calls } = makeCustomStrategy();
        const deleteCalls: { authHeader: string | undefined }[] = [];
        let sessionEndpointHits = 0;

        globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
            const urlStr = typeof url === 'string'
                ? url
                : url instanceof URL ? url.toString() : url.url;
            const headers = init?.headers as Record<string, string> | undefined;

            if (urlStr.endsWith('/session')) {
                sessionEndpointHits++;

                return new Response('{}', { status: 200 });
            }

            if (urlStr.includes('/admin/matters/5')) {
                deleteCalls.push({ authHeader: headers?.Authorization });

                if (deleteCalls.length === 1) return new Response('Unauthorized', { status: 401 });

                return new Response(JSON.stringify({ ok: true }), { status: 200 });
            }

            return new Response('not found', { status: 404 });
        }) as typeof fetch;

        const options: CliOptions = {
            name: 'testcli',
            description: 'test',
            version: '1.0.0',
            specPath: '/v3/api-docs',
            auth: strategy,
            refreshOn: [401],
            generatedDir,
            configPath,
        };
        const cli: Cli = createCli(options);

        // The run() path (~L546-661) builds `ctx` — including the wired
        // ApiClient — synchronously during command registration, before argv
        // is parsed. A consumer command registrar is the only surface that
        // observes that ctx, so capture it there rather than driving a real
        // generated subcommand through Commander.
        let capturedCtx: CliContext | null = null;
        cli.command('probe', (_program, ctx) => {
            capturedCtx = ctx;
        });

        const originalArgv = process.argv;
        const originalExit = process.exit;
        const originalLog = console.log;
        // No-args invocation prints custom help and exits — well after client
        // wiring and consumer command registration have already run.
        process.argv = ['node', 'testcli'];
        process.exit = (() => {
            throw new Error('__exit__');
        }) as never;
        console.log = () => {};

        try {
            await cli.run();
        } catch (e) {
            if ((e as Error).message !== '__exit__') throw e;
        } finally {
            process.argv = originalArgv;
            process.exit = originalExit;
            console.log = originalLog;
        }

        expect(capturedCtx).not.toBeNull();
        const client = capturedCtx!.client as { deleteMatter(id: number): Promise<unknown> };
        const result = await client.deleteMatter(5);

        expect(result).toEqual({ ok: true });
        expect(sessionEndpointHits).toBe(0);
        expect(calls.count).toBe(2);
        expect(deleteCalls).toHaveLength(2);
        expect(deleteCalls[0]!.authHeader).toBe('Bearer token-1');
        expect(deleteCalls[1]!.authHeader).toBe('Bearer token-2');
    });
});
