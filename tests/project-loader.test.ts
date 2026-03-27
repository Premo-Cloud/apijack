import { describe, test, expect, afterEach } from 'bun:test';
import { loadProjectAuth, loadProjectCommands, loadProjectDispatchers } from '../src/project-loader';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const testRoot = join(tmpdir(), 'apijack-loader-test-' + Date.now());

describe('loadProjectAuth()', () => {
    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });
    });

    test('returns null when no auth.ts exists', async () => {
        mkdirSync(testRoot, { recursive: true });
        const result = await loadProjectAuth(testRoot);
        expect(result).toBeNull();
    });

    test('loads auth strategy from auth.ts', async () => {
        mkdirSync(testRoot, { recursive: true });
        writeFileSync(join(testRoot, 'auth.ts'), `
            export default {
                async authenticate(config) {
                    return { headers: { Authorization: 'Custom test' } };
                },
                async restore(cached) {
                    return cached;
                },
            };
        `);

        const result = await loadProjectAuth(testRoot);
        expect(result).not.toBeNull();
        expect(typeof result!.authenticate).toBe('function');
    });
});

describe('loadProjectCommands()', () => {
    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });
    });

    test('returns empty array when no commands/ dir exists', async () => {
        mkdirSync(testRoot, { recursive: true });
        const result = await loadProjectCommands(testRoot);
        expect(result).toEqual([]);
    });

    test('loads command registrars from commands/*.ts', async () => {
        const cmdDir = join(testRoot, 'commands');
        mkdirSync(cmdDir, { recursive: true });
        writeFileSync(join(cmdDir, 'deploy.ts'), `
            export const name = 'deploy';
            export default function register(program, ctx) {
                program.command('deploy').action(() => {});
            }
        `);

        const result = await loadProjectCommands(testRoot);
        expect(result).toHaveLength(1);
        expect(result[0]!.name).toBe('deploy');
        expect(typeof result[0]!.registrar).toBe('function');
    });

    test('loads multiple commands', async () => {
        const cmdDir = join(testRoot, 'commands');
        mkdirSync(cmdDir, { recursive: true });
        writeFileSync(join(cmdDir, 'a.ts'), `
            export const name = 'a';
            export default function register(program, ctx) {}
        `);
        writeFileSync(join(cmdDir, 'b.ts'), `
            export const name = 'b';
            export default function register(program, ctx) {}
        `);

        const result = await loadProjectCommands(testRoot);
        expect(result).toHaveLength(2);
    });
});

describe('loadProjectDispatchers()', () => {
    afterEach(() => {
        rmSync(testRoot, { recursive: true, force: true });
    });

    test('returns empty map when no dispatchers/ dir exists', async () => {
        mkdirSync(testRoot, { recursive: true });
        const result = await loadProjectDispatchers(testRoot);
        expect(result.size).toBe(0);
    });

    test('loads dispatcher handlers from dispatchers/*.ts', async () => {
        const dispDir = join(testRoot, 'dispatchers');
        mkdirSync(dispDir, { recursive: true });
        writeFileSync(join(dispDir, 'notify.ts'), `
            export const name = 'notify';
            export default async function handle(args, positionalArgs, ctx) {
                return { sent: true };
            }
        `);

        const result = await loadProjectDispatchers(testRoot);
        expect(result.size).toBe(1);
        expect(result.has('notify')).toBe(true);
        expect(typeof result.get('notify')).toBe('function');
    });
});
