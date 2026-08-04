import { describe, test, expect, afterEach } from 'bun:test';
import { loadProjectSettings } from '../src/settings';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testRoot = join(tmpdir(), 'apijack-settings-test-' + Date.now());

describe('loadProjectSettings()', () => {
    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });
    });

    test('returns empty object when settings.json is missing', () => {
        mkdirSync(testRoot, { recursive: true });
        expect(loadProjectSettings(testRoot)).toEqual({});
    });

    test('reads customCommands.defaults.requiresAuth', () => {
        mkdirSync(testRoot, { recursive: true });
        writeFileSync(
            join(testRoot, 'settings.json'),
            JSON.stringify({ customCommands: { defaults: { requiresAuth: true } } }),
        );

        const settings = loadProjectSettings(testRoot);
        expect(settings.customCommands?.defaults?.requiresAuth).toBe(true);
    });

    test('reads auth.refreshOn', () => {
        mkdirSync(testRoot, { recursive: true });
        writeFileSync(
            join(testRoot, 'settings.json'),
            JSON.stringify({ auth: { refreshOn: [401] } }),
        );

        const settings = loadProjectSettings(testRoot);
        expect(settings.auth?.refreshOn).toEqual([401]);
    });

    test('returns empty object on malformed JSON', () => {
        mkdirSync(testRoot, { recursive: true });
        writeFileSync(join(testRoot, 'settings.json'), '{ not json');
        expect(loadProjectSettings(testRoot)).toEqual({});
    });
});
