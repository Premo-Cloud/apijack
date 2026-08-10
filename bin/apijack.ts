#!/usr/bin/env bun
// bin/apijack.ts
import { resolve, join, dirname } from 'path';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { createCli } from '../src/cli-builder';
import type { AuthStrategy, SessionAuthConfig } from '../src/auth/types';
import { BasicAuthStrategy } from '../src/auth/basic';
import { BearerTokenStrategy } from '../src/auth/bearer';
import { ApiKeyStrategy } from '../src/auth/api-key';
import { findProjectConfig, loadProjectConfig, resolveConfigDir } from '../src/project';
import { loadProjectAuth, loadProjectCommands, loadProjectDispatchers, loadProjectPlugins, loadProjectResolvers } from '../src/project-loader';
import { loadProjectSettings } from '../src/settings';
import { checkForUpdate } from '../src/updater';
import { getActiveEnvConfig } from '../src/config';
import pkg from '../package.json';

const VERSION = pkg.version;
const CLI_NAME = 'apijack';

// 1. Ensure global data dir exists
const globalDir = join(homedir(), '.apijack');
mkdirSync(globalDir, { recursive: true });

// 2. Check for updates (24h throttle)
await checkForUpdate(VERSION, globalDir);

// 3. Detect project mode
const projectConfigPath = findProjectConfig(process.cwd());
const projectConfig = projectConfigPath ? loadProjectConfig(projectConfigPath) : null;
const configDir = resolveConfigDir(projectConfigPath);
const projectRoot = projectConfigPath ? dirname(projectConfigPath) : null;

// Load .env from project root (Bun auto-loads from cwd, which may differ when invoked via symlink)
if (projectRoot) {
    const envPath = join(projectRoot, '.env');

    if (existsSync(envPath)) {
        for (const line of readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
            const trimmed = line.trim();

            if (!trimmed || trimmed.startsWith('#')) continue;

            const eq = trimmed.indexOf('=');

            if (eq < 0) continue;

            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();

            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                val = val.slice(1, -1);
            }

            if (!(key in process.env)) {
                process.env[key] = val;
            }
        }
    }
}

// 4. Resolve generated dir
let generatedDir: string;

if (projectConfig?.generatedDir && projectRoot) {
    generatedDir = resolve(projectRoot, projectConfig.generatedDir);
} else if (projectRoot) {
    generatedDir = resolve(projectRoot, '.apijack', 'generated');
} else {
    const env = getActiveEnvConfig(CLI_NAME, { configPath: join(configDir, 'config.json') });
    const hostname = env?.url ? new URL(env.url).hostname : 'default';
    generatedDir = join(globalDir, 'apis', hostname, 'generated');
}

// 5. Resolve spec path
let specPath = '/v3/api-docs';

if (projectConfig?.specUrl) {
    try {
        specPath = new URL(projectConfig.specUrl).pathname;
    } catch {
        specPath = projectConfig.specUrl;
    }
}

// 6. Resolve auth strategy — project auth.ts > config authType > default basic
let authStrategy: AuthStrategy = new BasicAuthStrategy();
let authResolved = false;

// Check for project-level custom auth first
let projectOnChallenge: SessionAuthConfig['onChallenge'] | null = null;

if (projectRoot) {
    const projectAuth = await loadProjectAuth(join(projectRoot, '.apijack'));

    if (projectAuth.strategy) {
        authStrategy = projectAuth.strategy;
        authResolved = true;
    }

    projectOnChallenge = projectAuth.onChallenge ?? null;
}

// Fall back to config-based auth type
if (!authResolved) {
    const env = getActiveEnvConfig(CLI_NAME, { configPath: join(configDir, 'config.json') });

    if (env) {
        const authType = (env as Record<string, unknown>).authType as string | undefined;

        if (authType === 'bearer') {
            authStrategy = new BearerTokenStrategy(async config => config.password);
        } else if (authType === 'apiKey') {
            const headerName = (env as Record<string, unknown>).authHeader as string ?? 'X-API-Key';
            const apiKey = (env as Record<string, unknown>).apiKey as string ?? '';
            authStrategy = new ApiKeyStrategy(headerName, apiKey);
        }
    }
}

// 7. Resolve sessionAuth from env config
let sessionAuth: SessionAuthConfig | undefined;
let onChallengeInjectedFrom: string | undefined;
{
    const env = getActiveEnvConfig(CLI_NAME, { configPath: join(configDir, 'config.json') });

    if (env) {
        sessionAuth = (env as Record<string, unknown>).sessionAuth as SessionAuthConfig | undefined;
    }

    if (sessionAuth && projectOnChallenge) {
        sessionAuth.onChallenge = projectOnChallenge;
        onChallengeInjectedFrom = '.apijack/auth.ts';
    }
}

// 8. Load project settings (framework-level flags, separate from per-env config)
const projectSettings = projectRoot
    ? loadProjectSettings(join(projectRoot, '.apijack'))
    : {};

// 9. Create CLI
//    `name` stays apijack so storage paths (~/.apijack/) and env-var prefix
//    (APIJACK_*) are unaffected. `programName`, `description`, and `version`
//    pull from .apijack.json when present so a delegating consumer brands its
//    own --help / setup output.
const cli = createCli({
    name: CLI_NAME,
    programName: projectConfig?.name ?? CLI_NAME,
    description: projectConfig?.description ?? 'Jack into any OpenAPI spec and rip a full-featured CLI',
    version: projectConfig?.version ?? VERSION,
    specPath,
    auth: authStrategy,
    sessionAuth,
    onChallengeInjectedFrom,
    refreshOn: projectSettings.auth?.refreshOn,
    generatedDir,
    allowedCidrs: projectConfig?.allowedCidrs,
    defaultUrl: projectConfig?.defaultUrl,
    configPath: join(configDir, 'config.json'),
    customCommandDefaults: projectSettings.customCommands?.defaults,
});

// 10. Register project-level extensions
if (projectRoot) {
    // Plugins register first so project resolvers/commands/dispatchers can
    // depend on plugin-provided resolver functions or registered state.
    const plugins = await loadProjectPlugins(join(projectRoot, '.apijack'));

    for (const plugin of plugins) {
        cli.use(plugin);
    }

    const commands = await loadProjectCommands(join(projectRoot, '.apijack'));

    for (const cmd of commands) {
        cli.command(cmd.name, cmd.registrar, { requiresAuth: cmd.requiresAuth });
    }

    const dispatchers = await loadProjectDispatchers(join(projectRoot, '.apijack'));

    for (const disp of dispatchers) {
        cli.dispatcher(disp.name, disp.handler, { requiresAuth: disp.requiresAuth });
    }

    const resolvers = await loadProjectResolvers(join(projectRoot, '.apijack'));

    for (const [name, fn] of resolvers) {
        cli.resolver(name, fn);
    }
}

// 11. Run
await cli.run();
