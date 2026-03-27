import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { prompt } from './prompt';

interface UpdateCheckData {
    lastChecked: string;
    latestVersion: string;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = 'https://registry.npmjs.org/apijack/latest';

export function shouldCheckForUpdate(dataDir: string): boolean {
    const data = loadUpdateCheck(dataDir);
    if (!data) return true;
    const elapsed = Date.now() - new Date(data.lastChecked).getTime();
    return elapsed > CHECK_INTERVAL_MS;
}

export function loadUpdateCheck(dataDir: string): UpdateCheckData | null {
    const filePath = join(dataDir, 'update-check.json');
    try {
        if (!existsSync(filePath)) return null;
        return JSON.parse(readFileSync(filePath, 'utf-8')) as UpdateCheckData;
    } catch {
        return null;
    }
}

export function saveUpdateCheck(dataDir: string, latestVersion: string): void {
    const filePath = join(dataDir, 'update-check.json');
    writeFileSync(filePath, JSON.stringify({
        lastChecked: new Date().toISOString(),
        latestVersion,
    }, null, 2) + '\n');
}

export async function checkForUpdate(
    currentVersion: string,
    dataDir: string,
): Promise<void> {
    if (!shouldCheckForUpdate(dataDir)) return;
    if (!process.stdin.isTTY) return;

    try {
        const res = await fetch(REGISTRY_URL);
        if (!res.ok) return;
        const data = await res.json() as { version: string };
        const latest = data.version;

        saveUpdateCheck(dataDir, latest);

        if (latest === currentVersion) return;
        if (!isNewer(latest, currentVersion)) return;

        const answer = await prompt(
            `apijack v${currentVersion} → v${latest} available. Update now? (y/N) `,
            'n',
        );

        if (answer.toLowerCase() === 'y') {
            console.log('Updating...');
            const proc = Bun.spawn(['bun', 'install', '-g', `apijack@${latest}`], {
                stdout: 'inherit',
                stderr: 'inherit',
            });
            const exitCode = await proc.exited;
            if (exitCode === 0) {
                console.log(`Updated to v${latest}. Re-running command...\n`);
                const reProc = Bun.spawn(process.argv, {
                    stdout: 'inherit',
                    stderr: 'inherit',
                    stdin: 'inherit',
                });
                process.exit(await reProc.exited);
            } else {
                console.error('Update failed. Continuing with current version.');
            }
        }
    } catch {
        // Network error — silently continue
    }
}

function isNewer(latest: string, current: string): boolean {
    const l = latest.split('.').map(Number);
    const c = current.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
        if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
    }
    return false;
}
