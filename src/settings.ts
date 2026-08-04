import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface ProjectSettings {
    customCommands?: {
        defaults?: {
            requiresAuth?: boolean;
        };
    };
    auth?: {
        /** HTTP statuses that trigger a one-shot session refresh + retry, for
         *  any auth strategy. See `CliOptions.refreshOn`. */
        refreshOn?: number[];
    };
}

export function loadProjectSettings(apijackDir: string): ProjectSettings {
    const settingsPath = join(apijackDir, 'settings.json');

    if (!existsSync(settingsPath)) return {};

    try {
        return JSON.parse(readFileSync(settingsPath, 'utf-8')) as ProjectSettings;
    } catch {
        return {};
    }
}
