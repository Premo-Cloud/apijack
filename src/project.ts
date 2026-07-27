import { existsSync, readFileSync } from 'fs';
import { join, dirname, resolve, parse } from 'path';
import { homedir } from 'os';

export interface ProjectConfig {
    name?: string;
    description?: string;
    version?: string;
    specUrl?: string;
    generatedDir?: string;
    auth?: string;
    allowedCidrs?: string[];
    /** URL pre-filled in the interactive setup prompts. Defaults to `http://localhost:8080`. */
    defaultUrl?: string;
}

export function findProjectConfig(startDir: string): string | null {
    let dir = resolve(startDir);
    const root = parse(resolve(startDir)).root;

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
