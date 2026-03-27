import { describe, test, expect, afterEach } from 'bun:test';
import { findProjectConfig, loadProjectConfig, resolveConfigDir, type ProjectConfig } from '../src/project';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testRoot = join(tmpdir(), 'apijack-project-test-' + Date.now());

describe('findProjectConfig()', () => {
    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });
    });

    test('finds .apijack.json in current directory', () => {
        mkdirSync(testRoot, { recursive: true });
        writeFileSync(join(testRoot, '.apijack.json'), '{}');

        const result = findProjectConfig(testRoot);
        expect(result).toBe(join(testRoot, '.apijack.json'));
    });

    test('finds .apijack.json in parent directory', () => {
        const child = join(testRoot, 'sub', 'deep');
        mkdirSync(child, { recursive: true });
        writeFileSync(join(testRoot, '.apijack.json'), '{}');

        const result = findProjectConfig(child);
        expect(result).toBe(join(testRoot, '.apijack.json'));
    });

    test('returns null when no .apijack.json exists', () => {
        mkdirSync(testRoot, { recursive: true });
        const result = findProjectConfig(testRoot);
        expect(result).toBeNull();
    });

    test('stops at filesystem root', () => {
        const result = findProjectConfig('/');
        expect(result).toBeNull();
    });
});

describe('loadProjectConfig()', () => {
    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });
    });

    test('loads valid project config', () => {
        mkdirSync(testRoot, { recursive: true });
        const config: ProjectConfig = {
            name: 'my-api',
            specUrl: 'http://localhost:8080/v3/api-docs',
            generatedDir: './src/generated',
        };
        writeFileSync(join(testRoot, '.apijack.json'), JSON.stringify(config));

        const result = loadProjectConfig(join(testRoot, '.apijack.json'));
        expect(result).not.toBeNull();
        expect(result!.name).toBe('my-api');
        expect(result!.specUrl).toBe('http://localhost:8080/v3/api-docs');
    });

    test('returns null for invalid JSON', () => {
        mkdirSync(testRoot, { recursive: true });
        writeFileSync(join(testRoot, '.apijack.json'), 'not json');

        const result = loadProjectConfig(join(testRoot, '.apijack.json'));
        expect(result).toBeNull();
    });

    test('loads optional fields', () => {
        mkdirSync(testRoot, { recursive: true });
        writeFileSync(join(testRoot, '.apijack.json'), JSON.stringify({
            name: 'test',
            specUrl: 'http://localhost:8080/v3/api-docs',
            auth: 'basic',
            allowedCidrs: ['192.168.1.0/24'],
        }));

        const result = loadProjectConfig(join(testRoot, '.apijack.json'));
        expect(result!.auth).toBe('basic');
        expect(result!.allowedCidrs).toEqual(['192.168.1.0/24']);
    });
});

describe('resolveConfigDir()', () => {
    test('returns project .apijack/ dir when project config path provided', () => {
        const result = resolveConfigDir('/home/user/myproject/.apijack.json');
        expect(result).toBe('/home/user/myproject/.apijack');
    });

    test('returns global dir when no project config', () => {
        const result = resolveConfigDir(null);
        expect(result).toContain('.apijack');
    });
});
