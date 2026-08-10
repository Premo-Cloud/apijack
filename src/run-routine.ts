import { resolve, join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { createCli, type RunRoutineOptions } from './cli-builder';
import type { RoutineResult } from './routine/executor';
import type { AuthStrategy, SessionAuthConfig } from './auth/types';
import { BasicAuthStrategy } from './auth/basic';
import { BearerTokenStrategy } from './auth/bearer';
import { ApiKeyStrategy } from './auth/api-key';
import { findProjectConfig, loadProjectConfig } from './project';
import {
    loadProjectAuth,
    loadProjectCommands,
    loadProjectDispatchers,
    loadProjectPlugins,
    loadProjectResolvers,
} from './project-loader';
import { loadProjectSettings } from './settings';
import { getActiveEnvConfig } from './config';

export interface StandaloneRunRoutineOptions extends RunRoutineOptions {
    cwd?: string;
    cliName?: string;
    programName?: string;
}

export async function runRoutine(
    name: string,
    opts: StandaloneRunRoutineOptions = {},
): Promise<RoutineResult> {
    const cwd = opts.cwd ?? process.cwd();
    // The spec describes a `settings.json` lookup for cliName, but `ProjectSettings`
    // has no `cliName` field — defaulting to 'apijack' (the shared binary name)
    // is the right behavior for the standalone helper's target use case.
    const cliName = opts.cliName ?? 'apijack';

    const projectConfigPath = findProjectConfig(cwd);
    const projectConfig = projectConfigPath ? loadProjectConfig(projectConfigPath) : null;
    const projectRoot = projectConfigPath ? dirname(projectConfigPath) : null;

    // Use process.env.HOME (if set) so tests can override the home dir without relying on
    // homedir(), which caches the OS value and ignores runtime HOME changes.
    const effectiveHome = process.env.HOME ?? homedir();
    const configDir = projectRoot
        ? join(projectRoot, '.apijack')
        : join(effectiveHome, `.${cliName}`);

    // Auto-load project .env so $_env(...) sees it.
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

    // Resolve generated dir.
    const globalDir = join(effectiveHome, `.${cliName}`);
    let generatedDir: string;

    // Cache the active env once — three call sites consumed it before, each re-reading config.json.
    // NOTE: opts.env (per spec) for selecting a specific named env is intentionally not yet wired —
    // would require plumbing through createCli/resolveAuth. Tracked as future work; consumers can
    // pre-switch via `apijack config switch <env>` for now.
    const envConfig = getActiveEnvConfig(cliName, { configPath: join(configDir, 'config.json') });

    if (projectConfig?.generatedDir && projectRoot) {
        generatedDir = resolve(projectRoot, projectConfig.generatedDir);
    } else if (projectRoot) {
        generatedDir = resolve(projectRoot, '.apijack', 'generated');
    } else {
        const hostname = envConfig?.url ? new URL(envConfig.url).hostname : 'default';

        generatedDir = join(globalDir, 'apis', hostname, 'generated');
    }

    // Resolve spec path.
    let specPath = '/v3/api-docs';

    if (projectConfig?.specUrl) {
        try {
            specPath = new URL(projectConfig.specUrl).pathname;
        } catch {
            specPath = projectConfig.specUrl;
        }
    }

    // Resolve auth strategy: project auth.ts > config authType > default basic.
    let authStrategy: AuthStrategy = new BasicAuthStrategy();
    let authResolved = false;
    let projectOnChallenge: SessionAuthConfig['onChallenge'] | null = null;

    if (projectRoot) {
        const projectAuth = await loadProjectAuth(join(projectRoot, '.apijack'));

        if (projectAuth.strategy) {
            authStrategy = projectAuth.strategy;
            authResolved = true;
        }

        projectOnChallenge = projectAuth.onChallenge ?? null;
    }

    if (!authResolved && envConfig) {
        const authType = (envConfig as Record<string, unknown>).authType as string | undefined;

        if (authType === 'bearer') {
            authStrategy = new BearerTokenStrategy(async config => config.password);
        } else if (authType === 'apiKey') {
            const headerName = (envConfig as Record<string, unknown>).authHeader as string ?? 'X-API-Key';
            const apiKey = (envConfig as Record<string, unknown>).apiKey as string ?? '';

            authStrategy = new ApiKeyStrategy(headerName, apiKey);
        }
    }

    let sessionAuth: SessionAuthConfig | undefined;
    let onChallengeInjectedFrom: string | undefined;

    if (envConfig) {
        sessionAuth = (envConfig as Record<string, unknown>).sessionAuth as SessionAuthConfig | undefined;

        if (sessionAuth && projectOnChallenge) {
            sessionAuth.onChallenge = projectOnChallenge;
            onChallengeInjectedFrom = '.apijack/auth.ts';
        }
    }

    const projectSettings = projectRoot ? loadProjectSettings(join(projectRoot, '.apijack')) : {};

    const cli = createCli({
        name: cliName,
        // Mirror bin/apijack.ts: prefer explicit override, then project config, then cliName.
        // Surfaces the project's brand in user-visible hints (e.g., the "No active env config.
        // Run '<programName> setup' ..." error) emitted by createCli().
        programName: opts.programName ?? projectConfig?.name ?? cliName,
        description: 'apijack',
        version: '0.0.0', // not relevant in programmatic mode
        specPath,
        auth: authStrategy,
        sessionAuth,
        onChallengeInjectedFrom,
        generatedDir,
        allowedCidrs: projectConfig?.allowedCidrs,
        configPath: join(configDir, 'config.json'),
        customCommandDefaults: projectSettings.customCommands?.defaults,
    });

    if (projectRoot) {
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

        for (const [resName, fn] of resolvers) {
            cli.resolver(resName, fn);
        }
    }

    return cli.runRoutine(name, { vars: opts.vars, dryRun: opts.dryRun });
}
