import type { Command } from 'commander';
import type { AuthStrategy, AuthSession, ResolvedAuth, SessionAuthConfig } from './auth/types';

export interface CliContext {
    client: unknown;
    session: AuthSession | null;
    auth: ResolvedAuth;
    strategy: AuthStrategy;
    refreshSession(): Promise<void>;
    resolveSession(): Promise<void>;
    saveSession(): Promise<void>;
}

export interface AuthedCliContext extends CliContext {
    session: AuthSession;
}

export interface CliOptions {
    /** Storage / session / env-var-prefix identity. Determines on-disk paths
     *  (~/.<name>/), the env-var prefix (NAME_URL/NAME_USER/NAME_PASS), and
     *  config namespacing. Should not change once a CLI ships. */
    name: string;
    /** Display-only name used in --help, the setup banner, and "Run '<cli> setup'"
     *  hints. Defaults to `name`. Lets a downstream CLI delegating to the shared
     *  `apijack` binary brand its own user-facing output without altering storage. */
    programName?: string;
    description: string;
    version: string;
    specPath: string;
    auth: AuthStrategy;
    sessionAuth?: SessionAuthConfig;
    /** HTTP statuses that trigger a one-shot session refresh + retry on the
     *  generated client, for ANY auth strategy (not just SessionAuthStrategy).
     *  Takes precedence over `sessionAuth.refreshOn` when both are set. Lets a
     *  project with a custom AuthStrategy opt in without a `sessionAuth` block. */
    refreshOn?: number[];
    /** Set by the shared-binary entry points when they inject a project-level
     *  `onChallenge` (from `.apijack/auth.ts`) into `sessionAuth`. Used only to
     *  attribute the injected key in the endpoint-less sessionAuth diagnostic. */
    onChallengeInjectedFrom?: string;
    outputModes?: string[];
    generatedDir?: string;
    knownSites?: Record<string, { url: string; description: string; group?: string }>;
    setupHook?: () => Promise<void>;
    builtinRoutinesDir?: string;
    preDispatch?: (command: string, args: Record<string, unknown>, ctx: CliContext) => Promise<void>;
    allowedCidrs?: string[];
    configPath?: string;
    customCommandDefaults?: { requiresAuth?: boolean };
    /** URL pre-filled in the interactive setup prompts. Defaults to `http://localhost:8080`.
     *  Prompt default only — it does not participate in the NAME_URL / saved-config
     *  resolution chain used for non-interactive runs. */
    defaultUrl?: string;
}

export type CommandRegistrar<R extends boolean = false> = R extends true
    ? (program: Command, ctx: AuthedCliContext) => void
    : (program: Command, ctx: CliContext) => void;

export type DispatcherHandler<R extends boolean = false> = R extends true
    ? (args: Record<string, unknown>, positionalArgs: unknown[], ctx: AuthedCliContext) => Promise<unknown>
    : (args: Record<string, unknown>, positionalArgs: unknown[], ctx: CliContext) => Promise<unknown>;

export interface CustomResolverHelpers {
    /** Resolve `$refs` and built-in functions inside a string against the current routine context. */
    resolve: (value: string) => unknown;
}

export type CustomResolver = (argsStr?: string, helpers?: CustomResolverHelpers) => unknown;

export type CommandDispatcher = (
    command: string,
    args: Record<string, unknown>,
    positionalArgs?: unknown[],
    /** Parent routine context. When set, sub-routine invocations (`routine run`)
     *  prefer the parent's per-routine resolver map over the CLI-global map,
     *  so parent `plugins:` factory output (e.g. seeded closures) flows into
     *  sub-routines that don't declare their own `plugins:` block. */
    routineCtx?: { customResolvers?: Map<string, CustomResolver> },
) => Promise<unknown>;

export interface ApijackPlugin {
    /** Plugin identifier. Must match /^[a-z][a-z0-9_]*$/. Also the required namespace prefix:
     *  a plugin named "faker" can register resolvers "_faker" and "_faker_*", and no others. */
    name: string;
    /** Semver string shown by `<cli> plugins list`. Not used for resolution logic. */
    version?: string;
    /** Stateless resolvers registered process-wide for every routine. */
    resolvers?: Record<string, CustomResolver>;
    /** Factory producing per-routine resolvers. Called once per routine with
     *  `routine.plugins[plugin.name] ?? {}`. Must tolerate `{}` (empty opts). */
    createRoutineResolvers?: (opts: unknown) => Record<string, CustomResolver>;
    /** Internal: set by the plugin's default export so core can locate its package.json.
     *  Typically set as `__package: { name: "@apijack/plugin-faker" }`. */
    __package?: { name: string; version?: string };
}
