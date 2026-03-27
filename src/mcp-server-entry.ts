import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

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

    const { startMcpServer } = await import('./mcp-server');
    await startMcpServer({
        cliName: 'apijack',
        cliInvocation: config.cliInvocation,
        generatedDir: config.generatedDir,
        routinesDir: join(homedir(), '.apijack', 'routines'),
        allowedCidrs: config.allowedCidrs,
    });
}
