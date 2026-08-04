import type { SessionAuthConfig } from './types';
import type { EnvironmentConfig } from '../config';
import { deepMergeSessionAuth } from './config-merge';

export interface RefreshWiringOptions {
    sessionAuth?: SessionAuthConfig;
    refreshOn?: number[];
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
 * and the run() path). Kept pure so both sites stay in lockstep (#135).
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
        console.warn(
            '[apijack] sessionAuth is set but missing session.endpoint — SessionAuthStrategy will not be used.',
        );
    }

    return { mergedSessionAuth, refreshOn };
}
