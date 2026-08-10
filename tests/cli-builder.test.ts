import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { createCli, type Cli } from '../src/cli-builder';
import type { CliOptions, CliContext, CommandRegistrar, DispatcherHandler, ApijackPlugin } from '../src/types';
import { BasicAuthStrategy } from '../src/auth/basic';
import { configUpdatePasswordAction } from '../src/commands/config/update-password/update-password';

const coreManifest = JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8'),
) as { version: string };

function makeOptions(overrides: Partial<CliOptions> = {}): CliOptions {
    return {
        name: 'testcli',
        description: 'A test CLI',
        version: '1.0.0',
        specPath: '/v3/api-docs',
        auth: new BasicAuthStrategy(),
        outputModes: ['json', 'table', 'quiet'],
        ...overrides,
    };
}

/**
 * Capture all output (console.log, console.error, and process.stdout.write)
 * during an async callback. Commander's --help writes directly to stdout.
 */
async function captureOutput(fn: () => Promise<void>): Promise<string> {
    const logs: string[] = [];
    const origLog = console.log;
    const origErr = console.error;
    const origWrite = process.stdout.write;

    console.log = (...args: unknown[]) => logs.push(args.join(' '));
    console.error = (...args: unknown[]) => logs.push(args.join(' '));
    process.stdout.write = (chunk: any, ...rest: any[]) => {
        logs.push(typeof chunk === 'string' ? chunk : chunk.toString());

        return true;
    };

    try {
        await fn();
    } catch {
    // Expected: process.exit calls
    } finally {
        console.log = origLog;
        console.error = origErr;
        process.stdout.write = origWrite;
    }

    return logs.join('\n');
}

describe('createCli()', () => {
    test('returns object with command(), dispatcher(), resolver(), run() methods', () => {
        const cli = createCli(makeOptions());
        expect(typeof cli.command).toBe('function');
        expect(typeof cli.dispatcher).toBe('function');
        expect(typeof cli.resolver).toBe('function');
        expect(typeof cli.run).toBe('function');
    });

    test('command() stores registrar for later invocation', () => {
        const cli = createCli(makeOptions());
        const registrar: CommandRegistrar = (_program, _ctx) => {};
        // Should not throw
        cli.command('my-cmd', registrar);
    // We verify this is wired correctly in integration-style tests below
    });

    test('dispatcher() stores handler for the composed dispatcher', () => {
        const cli = createCli(makeOptions());
        const handler: DispatcherHandler = async (_args, _pos, _ctx) => ({});
        // Should not throw
        cli.dispatcher('my-dispatch', handler);
    });

    test('resolver() stores handler for the composed dispatcher', () => {
        const cli = createCli(makeOptions());
        // Should not throw
        cli.resolver('_my_fn', _argsStr => 'ok');
    });
});

/**
 * To test the built-in commands without actually running the full auth flow,
 * we construct the CLI and inspect the Commander program that would be built.
 * We do this by mocking process.argv and intercepting parseAsync.
 */
describe('built-in commands', () => {
    let originalArgv: string[];
    let originalExit: typeof process.exit;
    let exitCode: number | undefined;

    beforeEach(() => {
        originalArgv = process.argv;
        originalExit = process.exit;
        exitCode = undefined;
        // Mock process.exit to prevent test runner from dying
        (process as any).exit = (code?: number) => {
            exitCode = code ?? 0;
            throw new Error(`process.exit(${code})`);
        };
    });

    afterEach(() => {
        process.argv = originalArgv;
        (process as any).exit = originalExit;
    });

    test('setup, login, config (list, switch), generate, and routine commands are registered', async () => {
    // Use --help with a non-existent command to force Commander to parse and build the tree
        const cli = createCli(makeOptions());

        // We can build a program internally by running with --help, which will call showCustomHelp and exit
        // Instead, let's test the structure by hooking into run() at the parse stage
        process.argv = ['node', 'testcli', '--help'];

        // Capture console output
        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => logs.push(args.join(' '));

        try {
            await cli.run();
        } catch (e: any) {
            // Expected: process.exit(0) from showCustomHelp
        }

        console.log = origLog;
        const output = logs.join('\n');

        // Verify core commands appear in help
        expect(output).toContain('setup');
        expect(output).toContain('login');
        expect(output).toContain('config');
        expect(output).toContain('generate');
        expect(output).toContain('routine');
    });

    test('knownSites option registers config import and config update-password', async () => {
        const cli = createCli(
            makeOptions({
                knownSites: {
                    staging: { url: 'https://staging.example.com', description: 'Staging' },
                },
            }),
        );

        process.argv = ['node', 'testcli', 'config', '--help'];

        const output = await captureOutput(() => cli.run());

        // config import and update-password should be registered as subcommands
        expect(output).toContain('import');
        expect(output).toContain('update-password');
    });

    test('config import is NOT registered when knownSites is not provided', async () => {
        const cli = createCli(makeOptions({ knownSites: undefined }));

        process.argv = ['node', 'testcli', 'config', '--help'];

        const output = await captureOutput(() => cli.run());

        // config import should NOT be present
        expect(output).not.toContain('import');
        expect(output).not.toContain('update-password');
    });

    test('output mode flags are registered (--table, --quiet, -o)', async () => {
        const cli = createCli(makeOptions());

        process.argv = ['node', 'testcli', '--help'];

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => logs.push(args.join(' '));

        try {
            await cli.run();
        } catch (e: any) {
            // Expected
        }

        console.log = origLog;
        const output = logs.join('\n');

        expect(output).toContain('--table');
        expect(output).toContain('--quiet');
        expect(output).toContain('-o <format>');
    });

    test('output mode flags respect outputModes option', async () => {
    // Only json mode (no table or quiet)
        const cli = createCli(makeOptions({ outputModes: ['json'] }));

        process.argv = ['node', 'testcli', '--help'];

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => logs.push(args.join(' '));

        try {
            await cli.run();
        } catch (e: any) {
            // Expected
        }

        console.log = origLog;
        const output = logs.join('\n');

        // --table and --quiet should NOT be registered since not in outputModes
        expect(output).not.toContain('--table');
        expect(output).not.toContain('--quiet');
        // -o should still be registered
        expect(output).toContain('-o <format>');
    });

    test('custom help separates core commands from API commands', async () => {
        const cli = createCli(makeOptions());

        process.argv = ['node', 'testcli', '--help'];

        const output = await captureOutput(() => cli.run());

        // Should show "Commands:" section with core commands
        expect(output).toContain('Commands:');
        // Should show usage and description
        expect(output).toContain('Usage: testcli');
        expect(output).toContain('A test CLI');
    });

    test('custom commands appear in their own section, visible without --help', async () => {
        const cli = createCli(makeOptions());
        cli.command('my-tool', (program) => {
            program.command('my-tool').description('A custom tool');
        });

        // No --help flag — just bare invocation
        process.argv = ['node', 'testcli'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain('Custom Commands:');
        expect(output).toContain('my-tool');
        expect(output).toContain('A custom tool');
    });

    test('custom commands section is hidden when there are none', async () => {
        const cli = createCli(makeOptions());

        process.argv = ['node', 'testcli'];

        const output = await captureOutput(() => cli.run());

        expect(output).not.toContain('Custom Commands:');
    });

    test('routine subcommands are registered (list, run, validate, test, init)', async () => {
        const cli = createCli(makeOptions());

        process.argv = ['node', 'testcli', 'routine', '--help'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain('list');
        expect(output).toContain('run');
        expect(output).toContain('validate');
        expect(output).toContain('test');
        expect(output).toContain('init');
    });

    test('env var prefix is derived from cliName uppercased', async () => {
    // Set env vars matching the test CLI name
        process.env.TESTCLI_URL = 'https://env.example.com';
        process.env.TESTCLI_USER = 'envuser';
        process.env.TESTCLI_PASS = 'envpass';

        const cli = createCli(makeOptions({ name: 'testcli' }));

        // Run with a non-existent command that won't match — we just want to verify auth resolution
        process.argv = ['node', 'testcli', '--help'];

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => logs.push(args.join(' '));

        try {
            await cli.run();
        } catch (e: any) {
            // Expected: process.exit from help
        }

        console.log = origLog;

        // Clean up
        delete process.env.TESTCLI_URL;
        delete process.env.TESTCLI_USER;
        delete process.env.TESTCLI_PASS;

        // If we got this far without error, env var resolution worked
        expect(exitCode).toBe(0);
    });

    test('program name and version are set correctly', async () => {
        const cli = createCli(
            makeOptions({
                name: 'mycli',
                description: 'My custom CLI tool',
                version: '2.5.0',
            }),
        );

        process.argv = ['node', 'mycli', '--help'];

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => logs.push(args.join(' '));

        try {
            await cli.run();
        } catch (e: any) {
            // Expected
        }

        console.log = origLog;
        const output = logs.join('\n');

        expect(output).toContain('Usage: mycli');
        expect(output).toContain('My custom CLI tool');
    });

    test('without programName, help and hints show storage name (cliName)', async () => {
        const cli = createCli(
            makeOptions({
                name: 'apijack',
                description: 'Default branding',
            }),
        );
        cli.command('extra', (program) => {
            program.command('extra').description('extra command');
        });

        // No --help flag triggers showCustomHelp's compact path that emits the
        // "run '<cliName> --help'" hint.
        process.argv = ['node', 'apijack'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain('Usage: apijack');
        expect(output).toContain("Run 'apijack <command> --help'");
    });

    test('programName overrides display name in help and hints, leaves cliName for storage', async () => {
        const cli = createCli(
            makeOptions({
                name: 'apijack',           // storage identity (unchanged)
                programName: 'rrc',        // display-only branding
                description: 'RRCloud CLI',
            }),
        );
        cli.command('extra', (program) => {
            program.command('extra').description('extra command');
        });

        process.argv = ['node', 'rrc'];

        const output = await captureOutput(() => cli.run());

        // Display strings show the override.
        expect(output).toContain('Usage: rrc');
        expect(output).toContain('RRCloud CLI');
        expect(output).toContain("Run 'rrc <command> --help'");
        // The bare "apijack" identity should NOT appear in user-facing branding.
        expect(output).not.toMatch(/Usage: apijack/);
        expect(output).not.toMatch(/Run 'apijack /);
    });

    test('programName defaults to name when omitted', async () => {
        const cli = createCli(
            makeOptions({
                name: 'foo',
                description: 'Foo CLI',
            }),
        );

        process.argv = ['node', 'foo', '--help'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain('Usage: foo');
    });

    test('--dry-run flag is registered', async () => {
        const cli = createCli(makeOptions());

        process.argv = ['node', 'testcli', '--help'];

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => logs.push(args.join(' '));

        try {
            await cli.run();
        } catch (e: any) {
            // Expected
        }

        console.log = origLog;
        const output = logs.join('\n');

        expect(output).toContain('--dry-run');
    });

    test('-o help text includes curl and curl-with-creds formats', async () => {
        const cli = createCli(makeOptions());

        process.argv = ['node', 'testcli', '--help'];

        const logs: string[] = [];
        const origLog = console.log;
        console.log = (...args: unknown[]) => logs.push(args.join(' '));

        try {
            await cli.run();
        } catch (e: any) {
            // Expected
        }

        console.log = origLog;
        const output = logs.join('\n');

        expect(output).toContain('curl');
        expect(output).toContain('curl-with-creds');
    });
});

describe('displayName threaded through subcommand registrar hints (#91)', () => {
    let originalArgv: string[];
    let originalExit: typeof process.exit;
    let testConfigDir: string;
    let configPath: string;

    beforeEach(() => {
        originalArgv = process.argv;
        originalExit = process.exit;

        (process as unknown as { exit: (code?: number) => void }).exit = (code?: number) => {
            throw new Error(`process.exit(${code ?? 0})`);
        };

        testConfigDir = join(tmpdir(), 'apijack-displayname-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        mkdirSync(testConfigDir, { recursive: true });
        configPath = join(testConfigDir, 'config.json');
        // Empty-environments config — triggers the "no envs configured" hint paths.
        writeFileSync(configPath, JSON.stringify({ active: '', environments: {} }));
    });

    afterEach(() => {
        process.argv = originalArgv;
        (process as unknown as { exit: typeof process.exit }).exit = originalExit;
        rmSync(testConfigDir, { recursive: true, force: true });
    });

    test('config list: hint uses programName when set', async () => {
        const cli = createCli(makeOptions({ name: 'apijack', programName: 'mycli', configPath }));

        process.argv = ['node', 'mycli', 'config', 'list'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain("Run 'mycli setup'");
        expect(output).not.toContain("Run 'apijack setup'");
    });

    test('config list: hint falls back to cliName when programName omitted', async () => {
        const cli = createCli(makeOptions({ name: 'apijack', configPath }));

        process.argv = ['node', 'apijack', 'config', 'list'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain("Run 'apijack setup'");
    });

    test('routine list: hint uses programName when set', async () => {
        const cli = createCli(makeOptions({ name: 'apijack', programName: 'mycli', configPath }));

        process.argv = ['node', 'mycli', 'routine', 'list'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain("Run 'mycli routine init'");
        expect(output).not.toContain("Run 'apijack routine init'");
    });

    test('routine list: hint falls back to cliName when programName omitted', async () => {
        const cli = createCli(makeOptions({ name: 'apijack', configPath }));

        process.argv = ['node', 'apijack', 'routine', 'list'];

        const output = await captureOutput(() => cli.run());

        expect(output).toContain("Run 'apijack routine init'");
    });

    test('configUpdatePasswordAction: throws with displayName when set', async () => {
        await expect(configUpdatePasswordAction({
            password: 'new',
            loadConfig: async () => ({ active: '', environments: {} }),
            save: async () => {},
            cliName: 'apijack',
            displayName: 'mycli',
            saveOpts: {},
        })).rejects.toThrow("Run 'mycli config import' first");
    });

    test('configUpdatePasswordAction: throws with cliName when displayName omitted', async () => {
        await expect(configUpdatePasswordAction({
            password: 'new',
            loadConfig: async () => ({ active: '', environments: {} }),
            save: async () => {},
            cliName: 'apijack',
            saveOpts: {},
        })).rejects.toThrow("Run 'apijack config import' first");
    });
});

describe('index exports', () => {
    test('all expected exports are available', async () => {
        const indexModule = await import('../src/index');

        // Functions
        expect(typeof indexModule.createCli).toBe('function');
        expect(typeof indexModule.BasicAuthStrategy).toBe('function');
        expect(typeof indexModule.BearerTokenStrategy).toBe('function');
        expect(typeof indexModule.ApiKeyStrategy).toBe('function');
        expect(typeof indexModule.formatOutput).toBe('function');
        expect(typeof indexModule.updateEnvironmentField).toBe('function');
        expect(typeof indexModule.verifyCredentials).toBe('function');
    });
});

describe('cli.use()', () => {
    test('accepts a plugin without error', () => {
        const cli = createCli({
            name: 'smoke',
            description: 'smoke',
            version: '0.0.0',
            specPath: '',
            auth: new BasicAuthStrategy(),
        });
        const plugin: ApijackPlugin = { name: 'noop', version: '0.1.0' };
        expect(() => cli.use(plugin)).not.toThrow();
    });

    test('throws when same plugin name registered twice', () => {
        const cli = createCli({
            name: 'smoke',
            description: 'smoke',
            version: '0.0.0',
            specPath: '',
            auth: new BasicAuthStrategy(),
        });
        cli.use({ name: 'x' });
        expect(() => cli.use({ name: 'x' })).toThrow(/already registered/);
    });
});

describe('cli.run() plugin validation', () => {
    test('throws PluginNamespaceError when plugin registers wrong-namespace resolver', async () => {
        const cli = createCli({
            name: 'smoke',
            description: 'smoke',
            version: '1.9.0',
            specPath: '',
            auth: new BasicAuthStrategy(),
        });
        cli.use({
            name: 'faker',
            resolvers: { _other: () => 'x' },
        });
        await expect(cli.run()).rejects.toThrow(/faker.*_other/);
    });

    test('throws PluginCollisionError when plugin shadows a core built-in', async () => {
        const cli = createCli({
            name: 'smoke',
            description: 'smoke',
            version: '1.9.0',
            specPath: '',
            auth: new BasicAuthStrategy(),
        });
        cli.use({
            name: 'uuid',
            resolvers: { _uuid: () => 'collision' },
        });
        await expect(cli.run()).rejects.toThrow(/_uuid/);
    });

    test('warns to stderr when plugin has no __package', async () => {
        let stderrOut = '';
        const origErrWrite = process.stderr.write.bind(process.stderr);
        const origOutWrite = process.stdout.write.bind(process.stdout);
        const origLog = console.log;
        const origExit = process.exit;

        try {
            process.stderr.write = ((c: string | Uint8Array) => {
                stderrOut += String(c);

                return true;
            }) as never;
            // Suppress stdout/help output and neutralise process.exit so run()'s downstream
            // help path can't terminate the test runner.
            process.stdout.write = (() => true) as never;
            console.log = () => {};
            (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
                throw new Error(`process.exit(${code})`);
            }) as never;
            const cli = createCli({
                name: 'smoke',
                description: 'smoke',
                version: '1.9.0',
                specPath: '',
                auth: new BasicAuthStrategy(),
            });
            cli.use({ name: 'nopkg', resolvers: { _nopkg: () => 'x' } });
            // run() may do more than validation; we just need it to at least reach the peer-check pass.
            // Catch any downstream errors unrelated to plugin validation.
            await cli.run().catch(() => {});
        } finally {
            process.stderr.write = origErrWrite as never;
            process.stdout.write = origOutWrite as never;
            console.log = origLog;
            (process as unknown as { exit: typeof origExit }).exit = origExit;
        }
        expect(stderrOut).toContain('nopkg');
        expect(stderrOut).toMatch(/did not self-report|skipping peer-version/i);
    });

    test('peer-version check reads core version, not consumer CLI version', async () => {
        const workDir = join(tmpdir(), `apijack-peer-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(join(workDir, 'node_modules', '@fake', 'plugin'), { recursive: true });
        const peerRange = `^${coreManifest.version.split('.')[0]}.0.0`;
        writeFileSync(
            join(workDir, 'node_modules', '@fake', 'plugin', 'package.json'),
            JSON.stringify({
                name: '@fake/plugin',
                version: '1.0.0',
                peerDependencies: { '@apijack/core': peerRange },
            }),
        );

        const origCwd = process.cwd();
        const origStderr = process.stderr.write.bind(process.stderr);
        const origStdout = process.stdout.write.bind(process.stdout);
        const origLog = console.log;
        const origExit = process.exit;

        try {
            process.chdir(workDir);
            process.stderr.write = (() => true) as never;
            process.stdout.write = (() => true) as never;
            console.log = () => {};
            process.exit = (() => {}) as never;

            const cli = createCli({
                name: 'consumer-cli',
                description: 'test',
                version: '99.0.0',
                specPath: '',
                auth: new BasicAuthStrategy(),
            });
            cli.use({
                name: 'fakep',
                resolvers: { _fakep: () => 'x' },
                __package: { name: '@fake/plugin' },
            });

            let thrown: unknown = null;

            try {
                await cli.run();
            } catch (e) {
                thrown = e;
            }
            expect(String(thrown)).not.toContain('PluginPeerMismatch');
        } finally {
            process.chdir(origCwd);
            process.stderr.write = origStderr as never;
            process.stdout.write = origStdout as never;
            console.log = origLog;
            process.exit = origExit;
            rmSync(workDir, { recursive: true, force: true });
        }
    });

    test('peer-version check throws when plugin peer range does not include core version', async () => {
        const workDir = join(tmpdir(), `apijack-peer-mismatch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(join(workDir, 'node_modules', '@fake', 'plugin'), { recursive: true });
        writeFileSync(
            join(workDir, 'node_modules', '@fake', 'plugin', 'package.json'),
            JSON.stringify({
                name: '@fake/plugin',
                version: '1.0.0',
                peerDependencies: { '@apijack/core': '^999.0.0' },
            }),
        );

        const origCwd = process.cwd();
        const origStderr = process.stderr.write.bind(process.stderr);
        const origStdout = process.stdout.write.bind(process.stdout);
        const origLog = console.log;
        const origExit = process.exit;

        try {
            process.chdir(workDir);
            process.stderr.write = (() => true) as never;
            process.stdout.write = (() => true) as never;
            console.log = () => {};
            process.exit = (() => {}) as never;
            const cli = createCli({
                name: 'consumer-cli',
                description: 'test',
                version: '0.1.0',
                specPath: '',
                auth: new BasicAuthStrategy(),
            });
            cli.use({
                name: 'fakep',
                resolvers: { _fakep: () => 'x' },
                __package: { name: '@fake/plugin' },
            });
            await expect(cli.run()).rejects.toThrow(/fakep.*\^999\.0\.0/);
        } finally {
            process.chdir(origCwd);
            process.stderr.write = origStderr as never;
            process.stdout.write = origStdout as never;
            console.log = origLog;
            process.exit = origExit;
            rmSync(workDir, { recursive: true, force: true });
        }
    });

    test('plugins check is reachable even when validation would fail at startup', async () => {
        const origArgv = process.argv;
        const origStderr = process.stderr.write.bind(process.stderr);
        const origStdout = process.stdout.write.bind(process.stdout);
        const origLog = console.log;
        const origExit = process.exit;
        let stderrOut = '';
        let exitCode: number | undefined;

        try {
            process.argv = ['node', 'cli', 'plugins', 'check'];
            process.stderr.write = ((c: string | Uint8Array) => {
                stderrOut += String(c);

                return true;
            }) as never;
            process.stdout.write = (() => true) as never;
            console.log = () => {};
            process.exit = ((code?: number) => {
                exitCode = code;
                throw new Error('__exit__');
            }) as never;

            const cli = createCli({
                name: 'smoke',
                description: 'smoke',
                version: '1.9.0',
                specPath: '',
                auth: new BasicAuthStrategy(),
            });
            // Register a plugin that would fail namespace validation.
            cli.use({
                name: 'faker',
                resolvers: { _other: () => 'x' },
            });

            // cli.run() would normally throw PluginNamespaceError at startup.
            // With the guard for `plugins check`, the action runs and reports
            // the error non-destructively via stderr + exit(1).
            try {
                await cli.run();
            } catch (e) {
                // swallow our synthetic exit
                if ((e as Error).message !== '__exit__') throw e;
            }
        } finally {
            process.argv = origArgv;
            process.stderr.write = origStderr as never;
            process.stdout.write = origStdout as never;
            console.log = origLog;
            process.exit = origExit;
        }
        expect(exitCode).toBe(1);
        expect(stderrOut).toContain('faker');
        expect(stderrOut).toContain('_other');
    });
});

describe('alias validation before codegen has run (#136)', () => {
    test('does not report unresolved generated-command aliases before `generate` has run', async () => {
        const workDir = join(tmpdir(), `apijack-alias-precodegen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const cliConfigDir = join(workDir, '.testcli');
        mkdirSync(cliConfigDir, { recursive: true });
        // Points at an operation that would only exist once `generate` has run.
        writeFileSync(
            join(cliConfigDir, 'aliases.json'),
            JSON.stringify({ cs: 'customers list-customers' }),
        );

        const origArgv = process.argv;
        const origStderr = process.stderr.write.bind(process.stderr);
        const origStdout = process.stdout.write.bind(process.stdout);
        const origLog = console.log;
        const origExit = process.exit;
        let stderrOut = '';

        try {
            process.argv = ['node', 'testcli', 'config', 'list'];
            process.stderr.write = ((c: string | Uint8Array) => {
                stderrOut += String(c);

                return true;
            }) as never;
            process.stdout.write = (() => true) as never;
            console.log = () => {};
            process.exit = (() => {
                throw new Error('__exit__');
            }) as never;

            const cli = createCli(makeOptions({
                configPath: join(cliConfigDir, 'config.json'),
                // No `generated/` at this path — the same state as a fresh
                // install where `generate` has not been run yet.
                generatedDir: join(workDir, 'src', 'generated'),
            }));

            try {
                await cli.run();
            } catch (e) {
                if ((e as Error).message !== '__exit__') throw e;
            }
        } finally {
            process.argv = origArgv;
            process.stderr.write = origStderr as never;
            process.stdout.write = origStdout as never;
            console.log = origLog;
            process.exit = origExit;
            rmSync(workDir, { recursive: true, force: true });
        }

        expect(stderrOut).not.toContain('does not resolve to a known command');
    });

    test('does not report unresolved generated-command aliases when codegen is partial (client exports no ApiClient) (#138)', async () => {
        const workDir = join(tmpdir(), `apijack-alias-partialcodegen-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        const cliConfigDir = join(workDir, '.testcli');
        const generatedDir = join(workDir, 'src', 'generated');
        mkdirSync(cliConfigDir, { recursive: true });
        mkdirSync(generatedDir, { recursive: true });
        // Points at an operation that would only exist once `generate` has fully run.
        writeFileSync(
            join(cliConfigDir, 'aliases.json'),
            JSON.stringify({ cs: 'customers list-customers' }),
        );
        // commandsModule exists (so `commandsModule` is truthy)...
        writeFileSync(
            join(generatedDir, 'commands.ts'),
            'export function registerGeneratedCommands(): void {}\n',
        );
        // ...but the client module imports cleanly without exporting `ApiClient`,
        // leaving `ApiClientClass` undefined and registration skipped.
        writeFileSync(join(generatedDir, 'client.ts'), 'export const somethingElse = 1;\n');

        const origArgv = process.argv;
        const origStderr = process.stderr.write.bind(process.stderr);
        const origStdout = process.stdout.write.bind(process.stdout);
        const origLog = console.log;
        const origExit = process.exit;
        let stderrOut = '';

        try {
            process.argv = ['node', 'testcli', 'config', 'list'];
            process.stderr.write = ((c: string | Uint8Array) => {
                stderrOut += String(c);

                return true;
            }) as never;
            process.stdout.write = (() => true) as never;
            console.log = () => {};
            process.exit = (() => {
                throw new Error('__exit__');
            }) as never;

            const cli = createCli(makeOptions({
                configPath: join(cliConfigDir, 'config.json'),
                generatedDir,
            }));

            try {
                await cli.run();
            } catch (e) {
                if ((e as Error).message !== '__exit__') throw e;
            }
        } finally {
            process.argv = origArgv;
            process.stderr.write = origStderr as never;
            process.stdout.write = origStdout as never;
            console.log = origLog;
            process.exit = origExit;
            rmSync(workDir, { recursive: true, force: true });
        }

        expect(stderrOut).not.toContain('does not resolve to a known command');
    });
});

describe('cli.runRoutine', () => {
    let tmpHome: string;
    let configPath: string;
    let cli: Cli;
    let originalHome: string | undefined;

    beforeEach(() => {
        tmpHome = join(tmpdir(), `runRoutine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
        const cliConfigDir = join(tmpHome, '.testcli');
        mkdirSync(join(cliConfigDir, 'routines'), { recursive: true });
        configPath = join(cliConfigDir, 'config.json');
        // Minimal env config so resolveAuth() returns something.
        writeFileSync(configPath, JSON.stringify({
            active: 'default',
            environments: {
                default: { url: 'http://localhost:9999', user: 'u', password: 'p' },
            },
        }));
        // Write a minimal routine YAML.
        writeFileSync(join(cliConfigDir, 'routines', 'echo.yaml'),
            `name: echo
steps:
  - name: ping
    command: my-dispatch
    args:
      msg: hello
    output: result
`);

        originalHome = process.env.HOME;
        process.env.HOME = tmpHome;

        cli = createCli({ ...makeOptions(), configPath });
        cli.dispatcher('my-dispatch', async args => ({ echoed: args.msg }));
    });

    afterEach(() => {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;

        rmSync(tmpHome, { recursive: true, force: true });
    });

    test('returns full RoutineResult shape on success', async () => {
        const result = await cli.runRoutine('echo');

        expect(result.status).toBe('ok');
        expect(result.success).toBe(true);
        expect(result.output).toEqual({ result: { echoed: 'hello' } });
        expect(result.steps).toHaveLength(1);
        expect(result.steps[0]!).toMatchObject({ name: 'ping', status: 'ok' });
        expect(typeof result.durationMs).toBe('number');
    });

    test('throws on missing routine', async () => {
        await expect(cli.runRoutine('does-not-exist')).rejects.toThrow();
    });

    test('is idempotent across repeated calls (no double-bootstrap)', async () => {
        const a = await cli.runRoutine('echo');
        const b = await cli.runRoutine('echo');
        expect(a.status).toBe('ok');
        expect(b.status).toBe('ok');
    });
});
