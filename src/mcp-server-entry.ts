import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { findProjectConfig, loadProjectConfig, resolveConfigDir } from './project';
import { getActiveEnvConfig } from './config';

export interface PluginConfig {
    cliInvocation: string[];
    generatedDir: string;
    allowedCidrs?: string[];
}

export function loadPluginConfig(dataDir?: string): PluginConfig | null {
    const dir = dataDir ?? join(homedir(), '.apijack');
    const configPath = join(dir, 'plugin.json');
    try {
        if (!existsSync(configPath)) return null;
        const raw = readFileSync(configPath, 'utf-8');
        return JSON.parse(raw) as PluginConfig;
    } catch {
        return null;
    }
}

// Entry point — only runs when executed directly
if (import.meta.main) {
    const config = loadPluginConfig();
    if (!config) {
        console.error("apijack plugin not configured. Run your CLI's 'plugin install' command first.");
        console.error('Expected config at: ~/.apijack/plugin.json');
        process.exit(1);
    }

    // Detect project mode from CWD
    const cwd = process.cwd();
    const projectConfigPath = findProjectConfig(cwd);
    const projectConfig = projectConfigPath ? loadProjectConfig(projectConfigPath) : null;
    const projectRoot = projectConfigPath ? dirname(projectConfigPath) : cwd;
    const configDir = resolveConfigDir(projectConfigPath);
    const configPath = join(configDir, 'config.json');

    // Resolve generatedDir using same logic as CLI entry point
    let generatedDir: string;
    if (projectConfig?.generatedDir && projectConfigPath) {
        generatedDir = resolve(projectRoot, projectConfig.generatedDir);
    } else if (projectConfigPath) {
        generatedDir = resolve(projectRoot, 'src', 'generated');
    } else {
        // Global mode — use hostname-based path
        const env = getActiveEnvConfig('apijack', { configPath });
        const hostname = env?.url ? new URL(env.url).hostname : 'default';
        generatedDir = join(homedir(), '.apijack', 'apis', hostname, 'generated');
    }

    const { startMcpServer } = await import('./mcp-server');
    await startMcpServer({
        cliName: 'apijack',
        cliInvocation: config.cliInvocation,
        generatedDir,
        routinesDir: join(configDir, 'routines'),
        projectRoot,
        configPath,
        allowedCidrs: config.allowedCidrs,
    });
}
