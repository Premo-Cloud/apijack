import type { SessionAuthConfig } from './types';
import type { EnvironmentConfig } from '../config';
import { deepMergeSessionAuth } from './config-merge';

export interface RefreshWiringOptions {
    sessionAuth?: SessionAuthConfig;
    refreshOn?: number[];
    /** Set by the shared-binary entry points when they inject a project-level
     *  `onChallenge` (from `.apijack/auth.ts`) into `sessionAuth`. Used only to
     *  attribute the injected key in the endpoint-less sessionAuth diagnostic. */
    onChallengeInjectedFrom?: string;
}

export interface RefreshWiring {
    /** Only set when the merged sessionAuth block defines a handshake endpoint —
     *  this is what drives SessionAuthStrategy construction and resolveRequestHeaders. */
    mergedSessionAuth: SessionAuthConfig | undefined;
    /** Statuses that trigger a one-shot session refresh + retry, for ANY strategy. */
    refreshOn: number[] | undefined;
}

/**
 * Decides the session-auth merge and refresh-retry wiring shared by both
 * cli-builder.ts client-construction sites (the createCli routine-runtime path
 * and the run() path). Shared by both sites so they stay in lockstep (#135);
 * the only side effect is a diagnostic console.warn on a suspicious sessionAuth
 * block (see below).
 *
 * `options.refreshOn` (from CliOptions / .apijack/settings.json) takes
 * precedence over `sessionAuth.refreshOn`, so a project can opt a custom
 * AuthStrategy into refresh-on-401 without ever defining a `sessionAuth` block.
 */
export function resolveRefreshWiring(
    options: RefreshWiringOptions,
    envConfig: Pick<EnvironmentConfig, 'sessionAuth'> | null | undefined,
): RefreshWiring {
    const rawSessionAuth = options.sessionAuth
        ? deepMergeSessionAuth(options.sessionAuth, envConfig?.sessionAuth)
        : undefined;
    // Only a block that actually defines a handshake endpoint drives SessionAuthStrategy
    // construction and request-header resolution.
    const mergedSessionAuth = rawSessionAuth?.session?.endpoint ? rawSessionAuth : undefined;
    const refreshOn = options.refreshOn ?? rawSessionAuth?.refreshOn;

    if (rawSessionAuth && !mergedSessionAuth) {
        // An endpoint-less block that carries nothing but `refreshOn` is a deliberate,
        // supported config (#135) — refreshOn survives the narrowing above precisely so
        // this works without a session.endpoint. Only warn when there's something else
        // in the block, which is the signature of a typo'd handshake key (e.g. `sessions:`
        // instead of `session:`) rather than an intentional refresh-only block.
        // An explicit `null` (e.g. from a JSON env config) still counts as "present" here
        // deliberately — the user typed it, and the key is genuinely dead without a
        // session.endpoint, so it's correct to name it in the warning (#150).
        const foundKeys = Object.keys(rawSessionAuth).filter(
            key => key !== 'refreshOn' && (rawSessionAuth as Record<string, unknown>)[key] !== undefined,
        );

        if (foundKeys.length > 0) {
            const renderedKeys = foundKeys.map(key =>
                key === 'onChallenge' && options.onChallengeInjectedFrom
                    ? `onChallenge (injected from ${options.onChallengeInjectedFrom})`
                    : key,
            );

            console.warn(
                `[apijack] sessionAuth is set but missing session.endpoint — SessionAuthStrategy will not be used. Found: ${renderedKeys.join(', ')}.`,
            );
        }
    }

    return { mergedSessionAuth, refreshOn };
}
