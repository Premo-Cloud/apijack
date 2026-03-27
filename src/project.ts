import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir } from 'os';

export interface ProjectConfig {
    name?: string;
    specUrl?: string;
    generatedDir?: string;
    auth?: string;
    allowedCidrs?: string[];
}

export function findProjectConfig(startDir: string): string | null {
    let dir = resolve(startDir);
    const root = resolve('/');

    while (dir !== root) {
        const candidate = join(dir, '.apijack.json');
        if (existsSync(candidate)) {
            return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return null;
}

export function loadProjectConfig(configPath: string): ProjectConfig | null {
    try {
        const raw = readFileSync(configPath, 'utf-8');
        return JSON.parse(raw) as ProjectConfig;
    } catch {
        return null;
    }
}

export function resolveConfigDir(projectConfigPath: string | null): string {
    if (projectConfigPath) {
        return join(dirname(projectConfigPath), '.apijack');
    }
    return join(homedir(), '.apijack');
}
