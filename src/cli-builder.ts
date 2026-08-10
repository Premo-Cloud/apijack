import { readFileSync } from 'fs';
import { Command } from 'commander';
import type {
    CliOptions,
    CliContext,
    CommandRegistrar,
    DispatcherHandler,
    CommandDispatcher,
    CustomResolver,
    ApijackPlugin,
} from './types';
import { resolveAuth, verifyCredentials, saveEnvironment, getActiveEnvConfig } from './config';
import { SessionManager } from './session';
import { formatOutput, type OutputMode } from './output';
import { formatDryRun, formatCurl, type CapturedRequest } from './output-request';
import { buildDispatcher } from './routine/dispatcher';
import { homedir } from 'os';
import { resolve, join } from 'path';
import { registerPluginCommand } from './plugin/register';
import { registerPluginsCommand } from './commands/plugins/register';
import { PluginRegistry } from './plugin/registry';
import { loadPluginPeerInfo, checkPeerRange } from './plugin/peer-version';
import { PluginPeerMismatchError } from './plugin/errors';
import { registerSetupCommand, setupAction, setupUrlDefault } from './commands/setup/setup';
import { registerConfigCommand } from './commands/config/register';
import { registerGenerateCommand } from './commands/generate/generate';
import { registerUpgradeCommand } from './commands/upgrade/upgrade';
import { registerMcpCommand } from './commands/mcp/mcp';
import { registerRoutineCommand, loadBuiltinRoutines } from './commands/routine/register';
import { prompt, hiddenPrompt } from './prompt';
import { SessionAuthStrategy } from './auth/session-auth';
import { resolveRequestHeaders } from './auth/resolve-headers';
import { resolveRefreshWiring } from './auth/refresh-wiring';
import type { SessionAuthConfig } from './auth/types';
import { loadPreRequestHook } from './pre-request';
import type { RoutineResult } from './routine/executor';
import { executeRoutine } from './routine/executor';
import { loadRoutineFile, validateRoutine } from './routine/loader';
import { loadAliases, collectCommandPaths, rewriteArgv, resolveLeadingTokens } from './aliases';

const coreManifest = JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8'),
) as { version: string };

export interface CommandOptions {
    requiresAuth?: boolean;
}

export interface DispatcherOptions {
    requiresAuth?: boolean;
}

export interface Cli {
    command(name: string, registrar: CommandRegistrar, options?: CommandOptions): void;
    dispatcher(name: string, handler: DispatcherHandler, options?: DispatcherOptions): void;
    resolver(name: string, handler: CustomResolver): void;
    use(plugin: ApijackPlugin): void;
    run(): Promise<void>;
    runRoutine(name: string, opts?: RunRoutineOptions): Promise<RoutineResult>;
}

export interface RunRoutineOptions {
    vars?: Record<string, unknown>;
    dryRun?: boolean;
}

const CORE_COMMANDS = new Set([
    'setup',
    'login',
    'config',
    'generate',
    'routine',
    'upgrade',
    'mcp',
    'plugin',
    'plugins',
]);

function showCustomHelp(
    program: Command,
    displayName: string,
    showAll: boolean,
    customCommandNames: Set<string>,
): void {
    console.log(`Usage: ${program.name()} [options] [command]\n`);
    console.log(`${program.description()}\n`);

    // Options
    console.log('Options:');

    for (const opt of program.options) {
        console.log(`  ${opt.flags.padEnd(30)} ${opt.description}`);
    }

    console.log(`  ${'-h, --help'.padEnd(30)} display help for command`);

    // Core commands
    const core = program.commands.filter(c => CORE_COMMANDS.has(c.name()));
    const custom = program.commands.filter(c => customCommandNames.has(c.name()));
    const api = program.commands.filter(
        c => !CORE_COMMANDS.has(c.name()) && !customCommandNames.has(c.name()) && c.name() !== 'help',
    );

    if (core.length > 0) {
        console.log('\nCommands:');

        for (const cmd of core) {
            console.log(`  ${cmd.name().padEnd(30)} ${cmd.description()}`);
        }
    }

    if (custom.length > 0) {
        console.log('\nCustom Commands:');

        for (const cmd of custom) {
            console.log(`  ${cmd.name().padEnd(30)} ${cmd.description()}`);
        }
    }

    if (showAll && api.length > 0) {
        console.log(`\nAPI Commands (${api.length}):`);

        for (const cmd of api) {
            console.log(`  ${cmd.name()}`);
        }
    } else if (api.length > 0) {
        console.log(
            `\n  ${api.length} API command groups available — run '${displayName} --help' to list all`,
        );
    }

    console.log(`\nRun '${displayName} <command> --help' for details on any command.`);
}

export function createCli(options: CliOptions): Cli {
    const consumerCommands: { name: string; registrar: CommandRegistrar; requiresAuth?: boolean }[] = [];
    const consumerDispatchers = new Map<string, { handler: DispatcherHandler; requiresAuth?: boolean }>();
    const consumerResolvers = new Map<string, CustomResolver>();
    const pluginRegistry = new PluginRegistry();
    const cliName = options.name;
    const displayName = options.programName ?? options.name;
    const configOpts = options.configPath ? { configPath: options.configPath } : undefined;
    const configDir = options.configPath
        ? resolve(options.configPath, '..')
        : join(homedir(), `.${cliName}`);
    const routinesDir = join(configDir, 'routines');
    const generatedDir = options.generatedDir ?? join(process.cwd(), 'src', 'generated');
    const defaultRequiresAuth = options.customCommandDefaults?.requiresAuth ?? false;
    const effectiveRequiresAuth = (explicit: boolean | undefined): boolean =>
        explicit ?? defaultRequiresAuth;

    let routineRuntime: {
        ctx: CliContext;
        dispatch: CommandDispatcher;
        customResolvers: Map<string, CustomResolver> | undefined;
        sessionMgr: SessionManager;
        routinesDir: string;
        builtinsMap: Record<string, string> | undefined;
    } | null = null;

    async function _buildRoutineRuntime(): Promise<NonNullable<typeof routineRuntime>> {
        if (routineRuntime) return routineRuntime;

        // 1. Validate plugins (matches cli.run() logic, minus the `plugins check` skip).
        pluginRegistry.validateAll(consumerResolvers);

        for (const plugin of pluginRegistry.getAll()) {
            if (!plugin.__package) {
                process.stderr.write(
                    `Warning: plugin "${plugin.name}" did not self-report its package; skipping peer-version check.\n`,
                );
                continue;
            }

            const info = loadPluginPeerInfo(plugin.__package.name, [process.cwd(), import.meta.dir]);
            const mismatchMsg = checkPeerRange({
                declaredRange: info.declaredRange,
                installedVersion: coreManifest.version,
            });

            if (mismatchMsg) {
                throw new PluginPeerMismatchError(
                    plugin.name,
                    info.declaredRange ?? '(none)',
                    coreManifest.version,
                );
            }
        }

        // 2. Resolve auth from active env config.
        const resolved = resolveAuth(cliName, configOpts);

        if (!resolved) {
            throw new Error(`No active env config. Run '${displayName} setup' to configure credentials.`);
        }

        // 3. Compute auth strategy + sessionMgr.
        const envConfig = getActiveEnvConfig(cliName, configOpts);
        const { mergedSessionAuth, refreshOn } = resolveRefreshWiring(options, envConfig);
        const strategy = mergedSessionAuth
            ? new SessionAuthStrategy(options.auth, mergedSessionAuth)
            : options.auth;
        const sessionMgr = new SessionManager(cliName, join(configDir, 'session.json'));

        // 4. Import generated client (best-effort — same as cli.run()).
        let ApiClientClass: (new (...args: unknown[]) => Record<string, unknown>) | null = null;

        try {
            const cmds = await import(resolve(generatedDir, 'commands'));

            if (cmds.registerGeneratedCommands) {
                const clientMod = await import(resolve(generatedDir, 'client'));
                ApiClientClass = clientMod.ApiClient;
            }
        } catch (err) {
            // A genuinely-absent module is expected before the first `generate`
            // (routines that don't dispatch to API methods still work) — stay
            // silent. A module that exists but fails to import (e.g. a codegen
            // syntax error) is a real problem — surface it to stderr.
            if ((err as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') {
                console.warn(`[apijack] Generated module failed to import: ${(err as Error).message}`);
            }
        }

        // 5. Build CliContext with lazy session.
        const ctx: CliContext = {
            client: null,
            session: null,
            auth: resolved,
            strategy,
            refreshSession: async () => {
                sessionMgr.invalidate();
                ctx.session = await sessionMgr.resolve(strategy, resolved);
            },
            resolveSession: async () => {
                if (ctx.session) return;

                ctx.session = await sessionMgr.resolve(strategy, resolved);
            },
            saveSession: async () => {
                if (ctx.session) {
                    sessionMgr.save(ctx.session);
                } else {
                    sessionMgr.invalidate();
                }
            },
        };

        // 6. Wire client if generated commands are present.
        if (ApiClientClass) {
            const getHeaders = (method: string) =>
                resolveRequestHeaders(ctx.session ?? { headers: {} }, mergedSessionAuth, method);

            const client = new ApiClientClass(
                resolved.baseUrl ?? '',
                getHeaders,
                async () => { await ctx.refreshSession(); },
                refreshOn,
            ) as Record<string, unknown>;

            ctx.client = client;
            client.ensureReady = ctx.resolveSession;

            // Pre-request hook (project-level)
            const consumerHook = await loadPreRequestHook(configDir);

            if (consumerHook && !consumerHook.beforeDryRun) {
                const existing = client.interceptRequest as
                    ((req: { method: string; url: string; body?: unknown }) => unknown | undefined) | undefined;
                client.interceptRequest = (req: { method: string; url: string; body?: unknown }) => {
                    if (existing) {
                        const result = existing(req);

                        if (result !== undefined) return result;
                    }

                    try {
                        consumerHook.handler(structuredClone(req));
                    } catch { /* observer */ }

                    return undefined;
                };
            } else if (consumerHook?.beforeDryRun) {
                client.preRequest = consumerHook.handler;
            }
        }

        // 7. Build commandMap import (best-effort).
        let commandMap:
            | Record<string, { operationId: string; pathParams: string[]; queryParams: string[]; hasBody: boolean }>
            | undefined;

        try {
            const mapModule = await import(resolve(generatedDir, 'command-map'));
            commandMap = mapModule.commandMap;
        } catch {
            // No command-map available
        }

        // 8. Merge custom resolvers (consumer + plugin stateless).
        const mergedResolvers = new Map<string, CustomResolver>(consumerResolvers);

        for (const plugin of pluginRegistry.getAll()) {
            for (const [key, fn] of Object.entries(plugin.resolvers ?? {})) {
                mergedResolvers.set(key, fn);
            }
        }

        const customResolvers = mergedResolvers.size > 0 ? mergedResolvers : undefined;

        // 9. Wrap dispatcher handlers with ensureReady where required.
        let dispatcherHandlers: Map<string, DispatcherHandler> | undefined;

        if (consumerDispatchers.size > 0) {
            dispatcherHandlers = new Map();

            for (const [name, entry] of consumerDispatchers) {
                if (effectiveRequiresAuth(entry.requiresAuth)) {
                    dispatcherHandlers.set(name, async (args, positional, dctx) => {
                        await ctx.resolveSession();

                        return entry.handler(args, positional, dctx);
                    });
                } else {
                    dispatcherHandlers.set(name, entry.handler);
                }
            }
        }

        // 10. Build dispatch.
        const builtinsMap = options.builtinRoutinesDir
            ? loadBuiltinRoutines(options.builtinRoutinesDir)
            : undefined;
        const dispatch = buildDispatcher({
            commandMap,
            client: ctx.client as Record<string, unknown> | undefined,
            consumerHandlers: dispatcherHandlers,
            customResolvers,
            pluginRegistry,
            preDispatch: options.preDispatch,
            ctx,
            routinesDir,
            builtinsMap,
        });

        routineRuntime = {
            ctx,
            dispatch,
            customResolvers,
            sessionMgr,
            routinesDir,
            builtinsMap,
        };

        return routineRuntime;
    }

    const cli: Cli = {
        command(name: string, registrar: CommandRegistrar, cmdOpts?: CommandOptions): void {
            consumerCommands.push({ name, registrar, requiresAuth: cmdOpts?.requiresAuth });
        },

        dispatcher(name: string, handler: DispatcherHandler, dispOpts?: DispatcherOptions): void {
            consumerDispatchers.set(name, { handler, requiresAuth: dispOpts?.requiresAuth });
        },

        resolver(name: string, handler: CustomResolver): void {
            consumerResolvers.set(name, handler);
        },

        use(plugin: ApijackPlugin): void {
            pluginRegistry.register(plugin);
        },

        async runRoutine(name: string, opts?: RunRoutineOptions): Promise<RoutineResult> {
            const runtime = await _buildRoutineRuntime();
            const def = loadRoutineFile(name, runtime.routinesDir, runtime.builtinsMap);
            const errors = validateRoutine(def);

            if (errors.length > 0) {
                throw new Error(`Validation errors:\n${errors.map(e => `  - ${e}`).join('\n')}`);
            }

            runtime.sessionMgr.invalidate();

            return executeRoutine(def, opts?.vars ?? {}, runtime.dispatch, {
                dryRun: opts?.dryRun,
                silent: true,
                customResolvers: runtime.customResolvers,
                pluginRegistry,
            });
        },

        async run(): Promise<void> {
            // Load aliases once; reused both for early best-effort token resolution
            // (so pre-build argv reads see through aliases) and for the late
            // validated argv rewrite that runs just before parseAsync.
            const { map: aliasMap, errors: aliasLoadErrors } = loadAliases(configDir, cliName);

            for (const err of aliasLoadErrors) {
                process.stderr.write(`${displayName}: aliases: ${err}\n`);
            }

            const effectiveArgs = resolveLeadingTokens(process.argv.slice(2), aliasMap);
            const effectiveArgv2 = effectiveArgs[0];
            const effectiveArgv3 = effectiveArgs[1];

            // 0. Validate plugins (namespace, collisions, peer versions).
            // Skip throwing when the user invoked `plugins check` so the command
            // can report all issues non-destructively.
            const isPluginsCheck = effectiveArgv2 === 'plugins' && effectiveArgv3 === 'check';

            if (!isPluginsCheck) {
                pluginRegistry.validateAll(consumerResolvers);

                for (const plugin of pluginRegistry.getAll()) {
                    if (!plugin.__package) {
                        process.stderr.write(
                            `Warning: plugin "${plugin.name}" did not self-report its package; skipping peer-version check.\n`,
                        );
                        continue;
                    }

                    const info = loadPluginPeerInfo(plugin.__package.name, [process.cwd(), import.meta.dir]);
                    const mismatchMsg = checkPeerRange({
                        declaredRange: info.declaredRange,
                        installedVersion: coreManifest.version,
                    });

                    if (mismatchMsg) {
                        throw new PluginPeerMismatchError(
                            plugin.name,
                            info.declaredRange ?? '(none)',
                            coreManifest.version,
                        );
                    }
                }
            }

            const program = new Command();

            // 1. Build Commander program
            program
                .name(displayName)
                .description(options.description)
                .version(options.version);

            // 2. Register output mode flags
            if (options.outputModes?.includes('table')) {
                program.option('--table', 'Output as table');
            }

            if (options.outputModes?.includes('quiet')) {
                program.option('--quiet', 'Suppress output');
            }

            program.option(
                '-o <format>',
                `Output format (${(options.outputModes || ['json', 'table', 'quiet']).join(', ')}, routine-step, curl, curl-with-creds)`,
            );
            program.option('--dry-run', 'Preview the API request without executing');

            // 3. Register built-in commands
            registerSetupCommand(program, cliName, {
                allowedCidrs: options.allowedCidrs,
                configPath: options.configPath,
                displayName,
                defaultUrl: options.defaultUrl,
            });
            registerConfigCommand(program, cliName, {
                configPath: options.configPath,
                knownSites: options.knownSites,
                allowedCidrs: options.allowedCidrs,
                displayName,
            });
            registerUpgradeCommand(program, options.version);
            registerMcpCommand(
                program,
                cliName,
                resolve(options.generatedDir || 'src/generated'),
                join(homedir(), '.' + options.name, 'routines'),
            );
            registerPluginCommand(program, cliName, options.version);
            registerPluginsCommand(program, pluginRegistry, options.version);

            // 4. Resolve auth
            let resolved = resolveAuth(cliName, configOpts);

            const cmd = effectiveArgv2;
            const skipAuthCommands = new Set([
                'login',
                'setup',
                'config',
                'routine',
                'generate',
                'upgrade',
                'mcp',
                'plugin',
                'plugins',
            ]);
            const isHelpOrVersion = cmd === '--help' || cmd === '-h'
                || cmd === '--version' || cmd === '-V'
                || process.argv.includes('--help') || process.argv.includes('-h');

            if (
                !resolved
                && process.stdin.isTTY
                && cmd
                && !skipAuthCommands.has(cmd)
                && !isHelpOrVersion
            ) {
                console.log(`${displayName} Setup\n`);
                const envName = await prompt('Environment name [default]: ', 'default');
                const urlDefault = setupUrlDefault(options.defaultUrl);
                const url = await prompt(`URL [${urlDefault}]: `, urlDefault);
                const user = await prompt('Username/Email: ');
                const password = await hiddenPrompt('Password: ');

                if (user && password) {
                    const result = await setupAction({
                        cliName, envName, url, user, password,
                        verify: verifyCredentials,
                        save: saveEnvironment,
                        saveOpts: configOpts ?? {},
                    });

                    if (!result.verified) {
                        console.error(result.verifyReason);
                        console.error("Credentials saved anyway — they'll be used when the server is available.");
                    } else {
                        console.log('Credentials verified.');
                    }

                    console.log(`Saved environment '${envName}' to ~/.${cliName}/config.json`);
                    console.log(`Switched to '${envName}'\n`);
                } else {
                    console.error('Setup cancelled.');
                    process.exit(2);
                }

                resolved = resolveAuth(cliName, configOpts);
            }

            // 5. Compute auth strategy (no network — just config)
            let mergedSessionAuth: SessionAuthConfig | undefined;
            let refreshOn: number[] | undefined;
            let strategy = options.auth;
            let sessionMgr: SessionManager | null = null;

            if (resolved) {
                const envConfig = getActiveEnvConfig(cliName, configOpts);
                ({ mergedSessionAuth, refreshOn } = resolveRefreshWiring(options, envConfig));
                strategy = mergedSessionAuth
                    ? new SessionAuthStrategy(options.auth, mergedSessionAuth)
                    : options.auth;
                sessionMgr = new SessionManager(cliName, join(configDir, 'session.json'));
            }

            // 5b. Register generate (depends on strategy + sessionMgr from step 5)
            registerGenerateCommand(
                program,
                cliName,
                options.specPath,
                generatedDir,
                configOpts,
                strategy,
                sessionMgr,
            );

            // 6. Import generated commands (ALWAYS — no auth needed)
            let commandsModule: Record<string, unknown> | null = null;
            let ApiClientClass: (new (...args: unknown[]) => Record<string, unknown>) | null = null;

            try {
                const cmds = await import(resolve(generatedDir, 'commands'));

                if (cmds.registerGeneratedCommands) {
                    commandsModule = cmds;
                    const clientMod = await import(resolve(generatedDir, 'client'));
                    ApiClientClass = clientMod.ApiClient;
                }
            } catch (err) {
                // A genuinely-absent module is expected before the consumer runs
                // `generate` — stay silent. A module that exists but fails to
                // import (e.g. a codegen syntax error) is a real problem — surface it.
                if ((err as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') {
                    console.warn(`[apijack] Generated module failed to import: ${(err as Error).message}`);
                }
            }

            // 7. Detect request-preview output modes
            const oIdx = process.argv.indexOf('-o');
            const oVal = oIdx >= 0 ? process.argv[oIdx + 1] : undefined;
            const isDryRun = process.argv.includes('--dry-run') && effectiveArgv2 !== 'routine';
            const isCurl = oVal === 'curl';
            const isCurlWithCreds = oVal === 'curl-with-creds';
            const isRoutineStep = oVal === 'routine-step';
            const isRequestPreview = isDryRun || isCurl || isCurlWithCreds;
            // Skip auth resolution for preview/inspection modes. curl-with-creds still resolves.
            const skipAuthResolution = isRoutineStep || isDryRun || isCurl || isHelpOrVersion;

            // Shared session resolver — lazy, runs on first API request or explicit consumer call
            const resolveSession = async (): Promise<void> => {
                if (!resolved || !sessionMgr) {
                    throw new Error(`Not authenticated. Run '${displayName} setup' to configure credentials.`);
                }

                if (ctx && ctx.session) return;

                const session = await sessionMgr.resolve(strategy, resolved);

                if (ctx) ctx.session = session;
            };

            // 8. Create CliContext with lazy session
            let ctx: CliContext | null = null;

            if (resolved) {
                ctx = {
                    client: null,
                    session: null,
                    auth: resolved,
                    strategy,
                    refreshSession: async () => {
                        sessionMgr!.invalidate();
                        ctx!.session = await sessionMgr!.resolve(strategy, resolved!);
                    },
                    resolveSession,
                    saveSession: async () => {
                        if (!sessionMgr) {
                            throw new Error(`Not authenticated. Run '${displayName} setup' to configure credentials.`);
                        }

                        if (ctx!.session) {
                            sessionMgr.save(ctx!.session);
                        } else {
                            sessionMgr.invalidate();
                        }
                    },
                };
            }

            // 9. Create ApiClient and register generated commands
            let generatedCommandsRegistered = false;

            if (commandsModule && ApiClientClass) {
                const registerFn = commandsModule.registerGeneratedCommands as (
                    program: Command, client: unknown, onResult: (result: unknown) => void,
                ) => void;

                // Headers provider — reads from resolved session
                const getHeaders = (method: string) =>
                    resolveRequestHeaders(ctx?.session ?? { headers: {} }, mergedSessionAuth, method);

                // Create client
                const client = new ApiClientClass(
                    resolved?.baseUrl ?? '',
                    getHeaders,
                    ctx ? async () => { await ctx!.refreshSession(); } : undefined,
                    refreshOn,
                ) as Record<string, unknown>;

                if (ctx) ctx.client = client;

                // Wire ensureReady — lazy session resolution before first real request
                client.ensureReady = resolveSession;

                // Wire interceptRequest for request-preview modes
                if (isRequestPreview) {
                    if (isCurlWithCreds) {
                        client.interceptRequest = async (
                            req: { method: string; url: string; body?: unknown },
                        ) => {
                            await resolveSession();

                            return {
                                ...req,
                                headers: { ...getHeaders(req.method), 'Content-Type': 'application/json' },
                            };
                        };
                    } else {
                        client.interceptRequest = (
                            req: { method: string; url: string; body?: unknown },
                        ) => ({
                            ...req,
                            headers: { 'Content-Type': 'application/json' },
                        });
                    }
                }

                // Wire consumer pre-request hook
                const consumerHook = await loadPreRequestHook(configDir);

                if (consumerHook) {
                    if (consumerHook.beforeDryRun) {
                        // Sees ALL requests (before interceptor). structuredClone in generated pipeline.
                        client.preRequest = consumerHook.handler;
                    } else if (!isRequestPreview) {
                        // Only sees real requests — compose after interceptor
                        const existingInterceptor = client.interceptRequest as
                            ((req: { method: string; url: string; body?: unknown }) => unknown | undefined) | undefined;
                        client.interceptRequest = (
                            req: { method: string; url: string; body?: unknown },
                        ) => {
                            if (existingInterceptor) {
                                const result = existingInterceptor(req);

                                if (result !== undefined) return result;
                            }

                            try {
                                consumerHook.handler(structuredClone(req));
                            } catch { /* observer */ }

                            return undefined;
                        };
                    }
                }

                // Build onResult handler
                const onResult = (result: unknown) => {
                    if (result === undefined) return;

                    // Handle request preview modes
                    if (isRequestPreview && result && typeof result === 'object' && 'method' in result && 'url' in result) {
                        const captured = result as CapturedRequest;

                        if (isCurl) {
                            console.log(formatCurl(captured, { includeCreds: false }));
                        } else if (isCurlWithCreds) {
                            console.log(formatCurl(captured, { includeCreds: true }));
                        } else {
                            console.log(formatDryRun(captured));
                        }

                        return;
                    }

                    const mode: OutputMode = program.opts().table
                        ? 'table'
                        : program.opts().quiet
                            ? 'quiet'
                            : 'json';
                    const output = formatOutput(result, mode);

                    if (output) console.log(output);
                };

                registerFn(program, client, onResult);
                generatedCommandsRegistered = true;
            }

            // 10. Register consumer commands and attach per-command requiresAuth preAction hooks.
            // Track the actual Command instances each registrar adds (not just the logical name),
            // so the hook still fires if the registrar names its subcommand differently.
            const requiresAuthCommands = new Set<Command>();

            for (const { registrar, requiresAuth } of consumerCommands) {
                const before = new Set(program.commands);
                // When auth is not configured, ctx is null. Consumers should only touch ctx
                // inside action callbacks (which won't run until run() is further along).
                registrar(program, ctx ?? (null as unknown as CliContext));

                if (effectiveRequiresAuth(requiresAuth)) {
                    for (const cmd of program.commands) {
                        if (!before.has(cmd)) requiresAuthCommands.add(cmd);
                    }
                }
            }

            if (requiresAuthCommands.size > 0 && !skipAuthResolution) {
                program.hook('preAction', async (_thisCommand, actionCommand) => {
                    let cmd: Command = actionCommand;

                    while (cmd.parent && cmd.parent !== program) cmd = cmd.parent;

                    if (requiresAuthCommands.has(cmd)) {
                        await resolveSession();
                    }
                });
            }

            // 11. Build dispatcher
            let commandMap:
                | Record<
                    string,
                    {
                        operationId: string;
                        pathParams: string[];
                        queryParams: string[];
                        hasBody: boolean;
                    }
                >
                | undefined;

            try {
                const mapModule = await import(resolve(generatedDir, 'command-map'));
                commandMap = mapModule.commandMap;
            } catch {
                // No command-map available
            }

            let dispatch: CommandDispatcher | undefined;

            // Merge consumer resolvers (from cli.resolver()) + stateless plugin resolvers
            const mergedResolvers = new Map<string, CustomResolver>(consumerResolvers);

            for (const plugin of pluginRegistry.getAll()) {
                for (const [key, fn] of Object.entries(plugin.resolvers ?? {})) {
                    mergedResolvers.set(key, fn);
                }
            }

            const customResolvers = mergedResolvers.size > 0 ? mergedResolvers : undefined;

            // Unwrap dispatcher entries and wrap requiresAuth handlers with ensureReady
            let dispatcherHandlers: Map<string, DispatcherHandler> | undefined;

            if (consumerDispatchers.size > 0) {
                dispatcherHandlers = new Map();

                for (const [name, entry] of consumerDispatchers) {
                    if (effectiveRequiresAuth(entry.requiresAuth)) {
                        dispatcherHandlers.set(name, async (args, positional, dctx) => {
                            await resolveSession();

                            return entry.handler(args, positional, dctx);
                        });
                    } else {
                        dispatcherHandlers.set(name, entry.handler);
                    }
                }
            }

            if (ctx) {
                dispatch = buildDispatcher({
                    commandMap,
                    client: ctx.client as Record<string, unknown> | undefined,
                    consumerHandlers: dispatcherHandlers,
                    customResolvers,
                    pluginRegistry,
                    preDispatch: options.preDispatch,
                    ctx,
                    routinesDir,
                    builtinsMap: options.builtinRoutinesDir
                        ? loadBuiltinRoutines(options.builtinRoutinesDir)
                        : undefined,
                });
            }

            // 12. Register routine commands
            registerRoutineCommand(program, cliName, routinesDir, dispatch, options.builtinRoutinesDir, customResolvers, pluginRegistry, displayName);

            // 13. Handle -o routine-step
            if (isRoutineStep) {
                program.hook('preAction', (_thisCommand, actionCommand) => {
                    const cmdParts: string[] = [];
                    let cmd: Command = actionCommand;

                    while (cmd.parent && cmd.parent !== program) {
                        cmdParts.unshift(cmd.name());
                        cmd = cmd.parent;
                    }

                    cmdParts.unshift(cmd.name());
                    const commandPath = cmdParts.join(' ');

                    // Get provided values
                    const opts = actionCommand.opts();
                    const providedArgs: Record<string, unknown> = {};

                    for (const [key, val] of Object.entries(opts)) {
                        if (val !== undefined && key !== 'output') {
                            providedArgs[`--${key}`] = val;
                        }
                    }

                    // Build output lines manually for comment support
                    const positional = actionCommand.args || [];
                    const lines: string[] = [];
                    lines.push(`- name: ${cmdParts[cmdParts.length - 1]}`);
                    lines.push(`  command: ${commandPath}`);

                    // Get all options from the command definition
                    const allOptions = (actionCommand as Command & { options: unknown[] }).options || [];
                    const skipFlags = new Set([
                        '-o',
                        '-V',
                    ]);
                    const isVerbose = process.argv.includes('-V');

                    if (
                        allOptions.length > 0
                        || Object.keys(providedArgs).length > 0
                    ) {
                        lines.push('  args:');
                        const emitted = new Set<string>();

                        // Provided args first (uncommented)
                        for (const [flag, val] of Object.entries(providedArgs)) {
                            if (skipFlags.has(flag)) continue;

                            lines.push(`    ${flag}: ${JSON.stringify(val)}`);
                            emitted.add(flag);
                        }

                        // Remaining options as commented-out
                        for (const opt of allOptions) {
                            const flag = opt.long || opt.short;

                            if (!flag || skipFlags.has(flag) || emitted.has(flag))
                                continue;

                            // Skip hidden (variant-specific) options unless -V
                            if (opt.hidden && !isVerbose) continue;

                            const desc = opt.description || '';
                            lines.push(
                                `    # ${flag}: "" # optional — ${desc}`,
                            );
                        }
                    }

                    if (positional.length > 0) {
                        lines.push('  args-positional:');

                        for (const p of positional)
                            lines.push(`    - ${JSON.stringify(p)}`);
                    }

                    console.log(lines.join('\n'));
                    process.exit(0);
                });
            }

            // 12. Custom help — intercept no-args and --help
            const userArgs = process.argv.slice(2);

            if (
                userArgs.length === 0
                || (userArgs.length === 1
                    && (userArgs[0] === '--help' || userArgs[0] === '-h'))
            ) {
                const showAll
                    = userArgs[0] === '--help' || userArgs[0] === '-h';
                const customCommandNames = new Set(consumerCommands.map(c => c.name));
                showCustomHelp(program, displayName, showAll, customCommandNames);
                process.exit(0);
            }

            // 13. Apply project-local aliases (.apijack/aliases.json) by rewriting argv
            // before Commander parses. Real command paths always win over aliases;
            // expansions that don't resolve to a known command are skipped with an error
            // — unless codegen hasn't run yet (or ran incompletely), in which case
            // there's nothing meaningful to validate against and unresolved expansions
            // are skipped silently.
            // The map was already loaded at the top of run() for early best-effort
            // resolution of pre-build argv reads — we reuse it here for the validated
            // rewrite now that the full Commander tree exists.
            if (Object.keys(aliasMap).length > 0) {
                const realPaths = collectCommandPaths(program);
                const { rewrittenArgs, warnings, errors } = rewriteArgv(
                    process.argv.slice(2),
                    aliasMap,
                    realPaths,
                    // Set iff generated-command registration actually ran, so this
                    // guard cannot diverge from the registration condition above.
                    { generatedCommandsPresent: generatedCommandsRegistered },
                );

                for (const w of warnings) {
                    process.stderr.write(`${displayName}: aliases: ${w}\n`);
                }

                for (const e of errors) {
                    process.stderr.write(`${displayName}: aliases: ${e}\n`);
                }

                process.argv = [...process.argv.slice(0, 2), ...rewrittenArgs];
            }

            // 14. Parse and execute
            await program.parseAsync();
        },
    };

    return cli;
}
