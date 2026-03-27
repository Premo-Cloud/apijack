import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { shouldCheckForUpdate, saveUpdateCheck, loadUpdateCheck } from '../src/updater';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testDir = join(tmpdir(), 'apijack-updater-test-' + Date.now());

describe('shouldCheckForUpdate()', () => {
    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    test('returns true when no check file exists', () => {
        expect(shouldCheckForUpdate(testDir)).toBe(true);
    });

    test('returns false when checked less than 24h ago', () => {
        saveUpdateCheck(testDir, '0.1.0');
        expect(shouldCheckForUpdate(testDir)).toBe(false);
    });

    test('returns true when checked more than 24h ago', () => {
        const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
        writeFileSync(
            join(testDir, 'update-check.json'),
            JSON.stringify({ lastChecked: oldTime, latestVersion: '0.1.0' }),
        );
        expect(shouldCheckForUpdate(testDir)).toBe(true);
    });
});

describe('saveUpdateCheck()', () => {
    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    test('saves check timestamp and version', () => {
        saveUpdateCheck(testDir, '0.2.0');
        const data = loadUpdateCheck(testDir);
        expect(data).not.toBeNull();
        expect(data!.latestVersion).toBe('0.2.0');
    });
});

describe('loadUpdateCheck()', () => {
    beforeEach(() => {
        mkdirSync(testDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true });
    });

    test('returns null when no file exists', () => {
        expect(loadUpdateCheck(testDir)).toBeNull();
    });

    test('returns parsed data', () => {
        writeFileSync(
            join(testDir, 'update-check.json'),
            JSON.stringify({ lastChecked: new Date().toISOString(), latestVersion: '1.0.0' }),
        );
        const data = loadUpdateCheck(testDir);
        expect(data!.latestVersion).toBe('1.0.0');
    });
});
