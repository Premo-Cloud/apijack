#!/usr/bin/env bun
// bin/apijack.ts
import { resolve, join, dirname } from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { createCli } from '../src/cli-builder';
import type { AuthStrategy } from '../src/auth/types';
import { BasicAuthStrategy } from '../src/auth/basic';
import { BearerTokenStrategy } from '../src/auth/bearer';
import { ApiKeyStrategy } from '../src/auth/api-key';
import { findProjectConfig, loadProjectConfig, resolveConfigDir } from '../src/project';
import { loadProjectAuth, loadProjectCommands, loadProjectDispatchers } from '../src/project-loader';
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

// 4. Resolve generated dir
let generatedDir: string;
if (projectConfig?.generatedDir && projectRoot) {
    generatedDir = resolve(projectRoot, projectConfig.generatedDir);
} else if (projectRoot) {
    generatedDir = resolve(projectRoot, 'src', 'generated');
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
if (projectRoot) {
    const projectAuth = await loadProjectAuth(join(projectRoot, '.apijack'));
    if (projectAuth) {
        authStrategy = projectAuth;
        authResolved = true;
    }
}

// Fall back to config-based auth type
if (!authResolved) {
    const env = getActiveEnvConfig(CLI_NAME, { configPath: join(configDir, 'config.json') });
    if (env) {
        const authType = (env as Record<string, unknown>).authType as string | undefined;
        if (authType === 'bearer') {
            authStrategy = new BearerTokenStrategy(async (config) => config.password);
        } else if (authType === 'apiKey') {
            const headerName = (env as Record<string, unknown>).authHeader as string ?? 'X-API-Key';
            const apiKey = (env as Record<string, unknown>).apiKey as string ?? '';
            authStrategy = new ApiKeyStrategy(headerName, apiKey);
        }
    }
}

// 7. Create CLI
const cli = createCli({
    name: CLI_NAME,
    description: 'Jack into any OpenAPI spec and rip a full-featured CLI',
    version: VERSION,
    specPath,
    auth: authStrategy,
    generatedDir,
    allowedCidrs: projectConfig?.allowedCidrs,
    configPath: join(configDir, 'config.json'),
});

// 8. Register project-level extensions
if (projectRoot) {
    const commands = await loadProjectCommands(join(projectRoot, '.apijack'));
    for (const cmd of commands) {
        cli.command(cmd.name, cmd.registrar);
    }

    const dispatchers = await loadProjectDispatchers(join(projectRoot, '.apijack'));
    for (const [name, handler] of dispatchers) {
        cli.dispatcher(name, handler);
    }
}

// 9. Run
await cli.run();
