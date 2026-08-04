import { describe, test, expect } from 'bun:test';
import { resolveRefreshWiring } from '../../src/auth/refresh-wiring';
import type { SessionAuthConfig } from '../../src/auth/types';

const fullSessionAuth: SessionAuthConfig = {
    session: { endpoint: '/session' },
    cookies: { extract: ['SESSION'], applyTo: ['POST', 'PUT', 'DELETE'] },
    refreshOn: [401, 403],
};

describe('resolveRefreshWiring', () => {
    test('no sessionAuth, no refreshOn — both undefined', () => {
        const result = resolveRefreshWiring({}, undefined);
        expect(result.mergedSessionAuth).toBeUndefined();
        expect(result.refreshOn).toBeUndefined();
    });

    test('options.refreshOn alone (no sessionAuth block) — refreshOn set, mergedSessionAuth stays undefined', () => {
        const result = resolveRefreshWiring({ refreshOn: [401] }, undefined);
        expect(result.mergedSessionAuth).toBeUndefined();
        expect(result.refreshOn).toEqual([401]);
    });

    test('sessionAuth with endpoint — mergedSessionAuth populated, refreshOn falls back to sessionAuth.refreshOn', () => {
        const result = resolveRefreshWiring({ sessionAuth: fullSessionAuth }, undefined);
        expect(result.mergedSessionAuth).toEqual(fullSessionAuth);
        expect(result.refreshOn).toEqual([401, 403]);
    });

    test('options.refreshOn takes precedence over sessionAuth.refreshOn', () => {
        const result = resolveRefreshWiring(
            { sessionAuth: fullSessionAuth, refreshOn: [401] },
            undefined,
        );
        expect(result.refreshOn).toEqual([401]);
        // mergedSessionAuth is untouched by the precedence rule.
        expect(result.mergedSessionAuth?.refreshOn).toEqual([401, 403]);
    });

    test('envConfig.sessionAuth merges into options.sessionAuth as usual', () => {
        const result = resolveRefreshWiring(
            { sessionAuth: fullSessionAuth },
            { sessionAuth: { session: { endpoint: '/auth/session' } } },
        );
        expect(result.mergedSessionAuth?.session.endpoint).toBe('/auth/session');
        expect(result.mergedSessionAuth?.cookies).toEqual(fullSessionAuth.cookies);
    });

    test('a sessionAuth block without session.endpoint does not populate mergedSessionAuth (guards resolveRequestHeaders)', () => {
        // Not expressible through the SessionAuthConfig type from a fully-typed
        // caller, but envConfig.sessionAuth is only a Partial<SessionAuthConfig> —
        // a JS/dynamic caller could still hand cli-builder a refreshOn-only block.
        const refreshOnlySessionAuth = { refreshOn: [401] } as unknown as SessionAuthConfig;
        const result = resolveRefreshWiring({ sessionAuth: refreshOnlySessionAuth }, undefined);
        expect(result.mergedSessionAuth).toBeUndefined();
        // refreshOn still surfaces from the raw (unguarded) merge.
        expect(result.refreshOn).toEqual([401]);
    });

    test('does not mutate inputs', () => {
        const sessionAuthCopy = JSON.parse(JSON.stringify(fullSessionAuth));
        resolveRefreshWiring(
            { sessionAuth: fullSessionAuth },
            { sessionAuth: { cookies: { applyTo: ['*'] } } },
        );
        expect(fullSessionAuth).toEqual(sessionAuthCopy);
    });
});
