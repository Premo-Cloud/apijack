import { existsSync, readFileSync, mkdirSync, cpSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface InstallOptions {
    version: string;
    claudeDir: string;
    userDataDir: string;
    sourceDir: string;
    cliInvocation: string[];
    generatedDir: string;
}

export interface InstallResult {
    success: boolean;
    pluginCacheDir: string;
    message: string;
}

export async function installPlugin(opts: InstallOptions): Promise<InstallResult> {
    const {
        version,
        claudeDir,
        userDataDir,
        sourceDir,
        cliInvocation,
        generatedDir,
    } = opts;

    const pluginCacheDir = join(claudeDir, 'plugins', 'cache', 'local', 'apijack', version);

    // 1. Copy plugin files to cache
    mkdirSync(join(pluginCacheDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginCacheDir, 'skills', 'apijack'), { recursive: true });

    // Copy .claude-plugin/plugin.json
    const manifestSrc = join(sourceDir, '.claude-plugin', 'plugin.json');
    if (existsSync(manifestSrc)) {
        cpSync(manifestSrc, join(pluginCacheDir, '.claude-plugin', 'plugin.json'));
    } else {
        writeFileSync(
            join(pluginCacheDir, '.claude-plugin', 'plugin.json'),
            JSON.stringify({
                name: 'apijack',
                description: 'Jack into any OpenAPI spec — full CLI with AI-agentic workflow automation',
                version,
            }, null, 2),
        );
    }

    // Copy .mcp.json
    const mcpSrc = join(sourceDir, '.mcp.json');
    if (existsSync(mcpSrc)) {
        cpSync(mcpSrc, join(pluginCacheDir, '.mcp.json'));
    }

    // Copy skills
    const skillSrc = join(sourceDir, 'skills', 'apijack', 'SKILL.md');
    if (existsSync(skillSrc)) {
        cpSync(skillSrc, join(pluginCacheDir, 'skills', 'apijack', 'SKILL.md'));
    }

    // Copy dist bundle if it exists
    const bundleSrc = join(sourceDir, 'dist', 'mcp-server.bundle.js');
    if (existsSync(bundleSrc)) {
        mkdirSync(join(pluginCacheDir, 'dist'), { recursive: true });
        cpSync(bundleSrc, join(pluginCacheDir, 'dist', 'mcp-server.bundle.js'));
    }

    // 2. Register in installed_plugins.json
    const installedPath = join(claudeDir, 'plugins', 'installed_plugins.json');
    mkdirSync(join(claudeDir, 'plugins'), { recursive: true });

    let installed: any = { version: 'v2', plugins: {} };
    if (existsSync(installedPath)) {
        try {
            installed = JSON.parse(readFileSync(installedPath, 'utf-8'));
        } catch {
            console.warn('Warning: could not parse installed_plugins.json, creating fresh');
        }
    }

    const now = new Date().toISOString();
    installed.plugins['apijack@local'] = [{
        scope: 'user',
        installPath: pluginCacheDir,
        version,
        installedAt: now,
        lastUpdated: now,
        gitCommitSha: '',
    }];

    writeFileSync(installedPath, JSON.stringify(installed, null, 2) + '\n');

    // 3. Enable in settings.json
    const settingsPath = join(claudeDir, 'settings.json');
    let settings: any = {};
    if (existsSync(settingsPath)) {
        try {
            settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
        } catch {
            console.warn('Warning: could not parse settings.json, creating fresh');
        }
    }

    if (!settings.enabledPlugins) settings.enabledPlugins = {};
    settings.enabledPlugins['apijack@local'] = true;

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

    // 4. Create user data directory
    mkdirSync(join(userDataDir, 'routines'), { recursive: true });

    // 5. Write plugin config for the MCP entry point
    writeFileSync(
        join(userDataDir, 'plugin.json'),
        JSON.stringify({ cliInvocation, generatedDir }, null, 2) + '\n',
    );

    return {
        success: true,
        pluginCacheDir,
        message: `apijack plugin v${version} installed successfully`,
    };
}
