import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Command } from 'commander';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import {
    loadAliases,
    collectCommandPaths,
    rewriteArgv,
    resolveLeadingTokens,
    type AliasMap,
} from '../src/aliases';

const testRoot = join(tmpdir(), 'apijack-aliases-test-' + Date.now());

describe('loadAliases()', () => {
    const cliName = `apijack-test-${Date.now()}`;
    const projectDir = join(testRoot, '.apijack');
    const globalDir = join(homedir(), '.' + cliName);

    beforeEach(() => {
        mkdirSync(projectDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });

        if (existsSync(globalDir)) rmSync(globalDir, { recursive: true, force: true });
    });

    test('returns empty map and no errors when neither file exists', () => {
        const result = loadAliases(projectDir, cliName);
        expect(result.map).toEqual({});
        expect(result.errors).toEqual([]);
    });

    test('loads project-local aliases.json', () => {
        writeFileSync(
            join(projectDir, 'aliases.json'),
            JSON.stringify({ cs: 'customers list' }),
        );

        const result = loadAliases(projectDir, cliName);
        expect(result.map).toEqual({ cs: 'customers list' });
        expect(result.errors).toEqual([]);
    });

    test('project-local entries override global entries on conflict', () => {
        mkdirSync(globalDir, { recursive: true });
        writeFileSync(
            join(globalDir, 'aliases.json'),
            JSON.stringify({ cs: 'customers global', g: 'generate' }),
        );
        writeFileSync(
            join(projectDir, 'aliases.json'),
            JSON.stringify({ cs: 'customers project' }),
        );

        const result = loadAliases(projectDir, cliName);
        expect(result.map).toEqual({ cs: 'customers project', g: 'generate' });
        expect(result.errors).toEqual([]);
    });

    test('reports malformed JSON and continues with the other file', () => {
        mkdirSync(globalDir, { recursive: true });
        writeFileSync(join(globalDir, 'aliases.json'), '{ this is not json');
        writeFileSync(
            join(projectDir, 'aliases.json'),
            JSON.stringify({ cs: 'customers list' }),
        );

        const result = loadAliases(projectDir, cliName);
        expect(result.map).toEqual({ cs: 'customers list' });
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain('malformed JSON');
    });

    test('rejects non-object root', () => {
        writeFileSync(join(projectDir, 'aliases.json'), JSON.stringify(['not', 'an', 'object']));

        const result = loadAliases(projectDir, cliName);
        expect(result.map).toEqual({});
        expect(result.errors[0]).toContain('expected a JSON object');
    });

    test('skips non-string values with an error', () => {
        writeFileSync(
            join(projectDir, 'aliases.json'),
            JSON.stringify({ ok: 'customers list', bad: 42 }),
        );

        const result = loadAliases(projectDir, cliName);
        expect(result.map).toEqual({ ok: 'customers list' });
        expect(result.errors[0]).toContain('alias "bad" must map to a string');
    });

    test('skips empty alias keys or values', () => {
        writeFileSync(
            join(projectDir, 'aliases.json'),
            JSON.stringify({ '   ': 'customers list', 'cs': '   ' }),
        );

        const result = loadAliases(projectDir, cliName);
        expect(result.map).toEqual({});
        expect(result.errors.length).toBe(2);
    });

    test('does not double-read when configDir already equals the global path', () => {
        mkdirSync(globalDir, { recursive: true });
        writeFileSync(
            join(globalDir, 'aliases.json'),
            JSON.stringify({ cs: 'customers list' }),
        );

        const result = loadAliases(globalDir, cliName);
        expect(result.map).toEqual({ cs: 'customers list' });
        expect(result.errors).toEqual([]);
    });
});

describe('collectCommandPaths()', () => {
    test('walks the Commander tree and returns dot-paths joined by spaces', () => {
        const program = new Command();
        const customers = program.command('customers');
        customers.command('list');
        customers.command('get-customer-order-summary');
        program.command('config').command('switch');

        const paths = collectCommandPaths(program);
        expect(paths.has('customers')).toBe(true);
        expect(paths.has('customers list')).toBe(true);
        expect(paths.has('customers get-customer-order-summary')).toBe(true);
        expect(paths.has('config')).toBe(true);
        expect(paths.has('config switch')).toBe(true);
    });

    test('returns empty set when program has no subcommands', () => {
        const program = new Command();
        expect(collectCommandPaths(program).size).toBe(0);
    });
});

describe('rewriteArgv()', () => {
    const realPaths = new Set([
        'customers',
        'customers list',
        'customers get-all-customers',
        'customers get-customer-order-summary',
        'config',
        'config switch',
        'generate',
    ]);

    test('rewrites a single-token alias and appends trailing args', () => {
        const aliases: AliasMap = { cs: 'customers get-customer-order-summary' };
        const result = rewriteArgv(['cs', '42', '--foo', 'bar'], aliases, realPaths);

        expect(result.rewrittenArgs).toEqual([
            'customers',
            'get-customer-order-summary',
            '42',
            '--foo',
            'bar',
        ]);
        expect(result.warnings).toEqual([]);
        expect(result.errors).toEqual([]);
    });

    test('rewrites a multi-token alias and appends trailing args', () => {
        const aliases: AliasMap = { 'customers summary': 'customers get-customer-order-summary' };
        const result = rewriteArgv(
            ['customers', 'summary', '42', '--foo', 'bar'],
            aliases,
            realPaths,
        );

        expect(result.rewrittenArgs).toEqual([
            'customers',
            'get-customer-order-summary',
            '42',
            '--foo',
            'bar',
        ]);
    });

    test('longest-prefix wins over shorter alias', () => {
        // Both aliases are valid (neither shadows a real command); the multi-token
        // one should beat the single-token one when both could match.
        const aliases: AliasMap = {
            'orders': 'customers list',
            'orders summary': 'customers get-customer-order-summary',
        };

        const result = rewriteArgv(['orders', 'summary', '42'], aliases, realPaths);
        expect(result.rewrittenArgs).toEqual([
            'customers',
            'get-customer-order-summary',
            '42',
        ]);

        const result2 = rewriteArgv(['orders', '99'], aliases, realPaths);
        expect(result2.rewrittenArgs).toEqual(['customers', 'list', '99']);
    });

    test('alias that shadows a real command path is skipped with a warning', () => {
        const aliases: AliasMap = { customers: 'config switch' };
        const result = rewriteArgv(['customers', 'list'], aliases, realPaths);

        // Real "customers" wins — argv unchanged
        expect(result.rewrittenArgs).toEqual(['customers', 'list']);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain('shadows a real command');
        expect(result.errors).toEqual([]);
    });

    test('alias whose expansion is unknown is skipped with an error', () => {
        const aliases: AliasMap = { cs: 'customers nope' };
        const result = rewriteArgv(['cs', '42'], aliases, realPaths);

        expect(result.rewrittenArgs).toEqual(['cs', '42']);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain('does not resolve');
    });

    test('returns args unchanged when no alias matches', () => {
        const aliases: AliasMap = { cs: 'customers get-customer-order-summary' };
        const result = rewriteArgv(['config', 'switch', 'prod'], aliases, realPaths);
        expect(result.rewrittenArgs).toEqual(['config', 'switch', 'prod']);
    });

    test('returns args unchanged when alias map is empty', () => {
        const result = rewriteArgv(['anything'], {}, realPaths);
        expect(result.rewrittenArgs).toEqual(['anything']);
    });

    test('returns args unchanged when args is empty', () => {
        const result = rewriteArgv([], { cs: 'customers list' }, realPaths);
        expect(result.rewrittenArgs).toEqual([]);
    });

    test('does not match a partial multi-token alias', () => {
        const aliases: AliasMap = { 'customers summary': 'customers get-customer-order-summary' };
        const result = rewriteArgv(['customers', 'list'], aliases, realPaths);
        expect(result.rewrittenArgs).toEqual(['customers', 'list']);
    });

    test('matches alias only when it appears as the leading tokens', () => {
        const aliases: AliasMap = { cs: 'customers list' };
        // alias appears mid-args, not at the start — should not rewrite
        const result = rewriteArgv(['config', 'cs'], aliases, realPaths);
        expect(result.rewrittenArgs).toEqual(['config', 'cs']);
    });

    test('pre-codegen: alias pointing at a generated path is skipped silently', () => {
        // Pre-codegen, "customers get-customer-order-summary" hasn't been registered
        // yet, so it's absent from realPaths — same situation as an unknown expansion.
        const aliases: AliasMap = { cs: 'customers get-customer-order-summary' };
        const result = rewriteArgv(['cs', '42'], aliases, new Set(['generate', 'config']), {
            generatedCommandsPresent: false,
        });

        expect(result.rewrittenArgs).toEqual(['cs', '42']);
        expect(result.errors).toEqual([]);
    });

    test('pre-codegen: alias pointing at a built-in path still rewrites', () => {
        const aliases: AliasMap = { g: 'generate' };
        const result = rewriteArgv(['g'], aliases, realPaths, {
            generatedCommandsPresent: false,
        });

        expect(result.rewrittenArgs).toEqual(['generate']);
        expect(result.errors).toEqual([]);
    });

    test('pre-codegen: shadow warning is still emitted', () => {
        const aliases: AliasMap = { customers: 'config switch' };
        const result = rewriteArgv(['customers', 'list'], aliases, realPaths, {
            generatedCommandsPresent: false,
        });

        expect(result.rewrittenArgs).toEqual(['customers', 'list']);
        expect(result.warnings.length).toBe(1);
        expect(result.warnings[0]).toContain('shadows a real command');
        expect(result.errors).toEqual([]);
    });

    test('post-codegen: broken alias still emits an error', () => {
        const aliases: AliasMap = { cs: 'customers nope' };
        const result = rewriteArgv(['cs', '42'], aliases, realPaths, {
            generatedCommandsPresent: true,
        });

        expect(result.rewrittenArgs).toEqual(['cs', '42']);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain('does not resolve');
    });

    test('option omitted: broken alias still emits an error (default is validation on)', () => {
        const aliases: AliasMap = { cs: 'customers nope' };
        const result = rewriteArgv(['cs', '42'], aliases, realPaths);

        expect(result.rewrittenArgs).toEqual(['cs', '42']);
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain('does not resolve');
    });
});

describe('resolveLeadingTokens()', () => {
    test('resolves a single-token alias without validation', () => {
        const result = resolveLeadingTokens(['gen', '--foo'], { gen: 'generate' });
        expect(result).toEqual(['generate', '--foo']);
    });

    test('resolves a multi-token alias and prefers longest prefix', () => {
        const aliases: AliasMap = {
            'r': 'routine',
            'r run': 'routine run',
        };
        expect(resolveLeadingTokens(['r', 'run', 'foo'], aliases)).toEqual([
            'routine',
            'run',
            'foo',
        ]);
        expect(resolveLeadingTokens(['r', 'list'], aliases)).toEqual(['routine', 'list']);
    });

    test('returns args unchanged when no alias matches', () => {
        const result = resolveLeadingTokens(['plugins', 'check'], { gen: 'generate' });
        expect(result).toEqual(['plugins', 'check']);
    });

    test('returns args unchanged when alias map is empty', () => {
        const result = resolveLeadingTokens(['anything'], {});
        expect(result).toEqual(['anything']);
    });

    test('returns empty when args is empty', () => {
        const result = resolveLeadingTokens([], { gen: 'generate' });
        expect(result).toEqual([]);
    });

    test('makes auth-skip work for built-in command aliases (gen → generate)', () => {
        // The whole point of this helper: argv[2] reads pre-Commander-build
        // see through the alias.
        const argv = ['gen'];
        const resolved = resolveLeadingTokens(argv, { gen: 'generate' });
        const skipAuth = new Set(['generate', 'setup', 'config']);
        expect(skipAuth.has(resolved[0])).toBe(true);
    });
});
