import { describe, test, expect, spyOn } from 'bun:test';
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

    describe('missing session.endpoint diagnostic warning', () => {
        test('is silent for a deliberate refreshOn-only sessionAuth block (#135, #148)', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            const refreshOnlySessionAuth = { refreshOn: [401] } as unknown as SessionAuthConfig;

            try {
                const result = resolveRefreshWiring({ sessionAuth: refreshOnlySessionAuth }, undefined);
                expect(warnSpy).not.toHaveBeenCalled();
                // refreshOn behavior from #135 is unchanged: it still surfaces from the
                // raw (unguarded) merge even though mergedSessionAuth stays undefined.
                expect(result.mergedSessionAuth).toBeUndefined();
                expect(result.refreshOn).toEqual([401]);
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('warns and names onChallenge when a refreshOn-only block also carries a defined onChallenge (intentional, #148)', () => {
            // bin/apijack.ts and src/run-routine.ts both inject `onChallenge` from
            // .apijack/auth.ts into the sessionAuth object before it reaches here, so a
            // project with a deliberate refreshOn-only block AND a custom onChallenge
            // export ends up with foundKeys === ['onChallenge']. That's NOT a leak of the
            // bug this file just fixed: onChallenge is only ever consumed by
            // SessionAuthStrategy, which is never constructed without a session.endpoint,
            // so in this exact config the hook is genuinely dead code — the warning is
            // pointing at a real mistake (an onChallenge that can never fire), not at the
            // supported refreshOn-only pattern.
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            const refreshOnlyWithChallenge = {
                refreshOn: [401],
                onChallenge: async () => {},
            } as unknown as SessionAuthConfig;

            try {
                const result = resolveRefreshWiring({ sessionAuth: refreshOnlyWithChallenge }, undefined);
                expect(warnSpy).toHaveBeenCalledTimes(1);
                const message = warnSpy.mock.calls[0]![0] as string;
                expect(message).toContain('session.endpoint');
                expect(message).toContain('onChallenge');
                expect(message).not.toContain('refreshOn');
                // refreshOn behavior from #135 is unchanged even in this configuration.
                expect(result.mergedSessionAuth).toBeUndefined();
                expect(result.refreshOn).toEqual([401]);
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('warns and names the found keys for a block with a typo\'d handshake key', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            // `sessions:` instead of `session:` — the block has handshake-shaped keys
            // but no reachable session.endpoint, which is the case the warning targets.
            const typoSessionAuth = {
                sessions: { endpoint: '/session' },
                cookies: { extract: ['SESSION'], applyTo: ['POST'] },
                refreshOn: [401],
            } as unknown as SessionAuthConfig;

            try {
                const result = resolveRefreshWiring({ sessionAuth: typoSessionAuth }, undefined);
                expect(warnSpy).toHaveBeenCalledTimes(1);
                const message = warnSpy.mock.calls[0]![0] as string;
                expect(message).toContain('session.endpoint');
                expect(message).toContain('sessions');
                expect(message).toContain('cookies');
                expect(message).not.toContain('refreshOn');
                // refreshOn behavior from #135 is unchanged: still surfaces even though
                // mergedSessionAuth stays undefined for the typo'd block.
                expect(result.mergedSessionAuth).toBeUndefined();
                expect(result.refreshOn).toEqual([401]);
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('does not warn when there is no sessionAuth at all', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

            try {
                resolveRefreshWiring({ refreshOn: [401] }, undefined);
                expect(warnSpy).not.toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('does not warn when sessionAuth has a session.endpoint', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

            try {
                resolveRefreshWiring({ sessionAuth: fullSessionAuth }, undefined);
                expect(warnSpy).not.toHaveBeenCalled();
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('attributes onChallenge to its injection source when onChallengeInjectedFrom is set (#150)', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            const refreshOnlyWithChallenge = {
                refreshOn: [401],
                onChallenge: async () => {},
            } as unknown as SessionAuthConfig;

            try {
                resolveRefreshWiring(
                    { sessionAuth: refreshOnlyWithChallenge, onChallengeInjectedFrom: '.apijack/auth.ts' },
                    undefined,
                );
                expect(warnSpy).toHaveBeenCalledTimes(1);
                const message = warnSpy.mock.calls[0]![0] as string;
                expect(message).toContain('onChallenge (injected from .apijack/auth.ts)');
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('renders onChallenge plain when onChallengeInjectedFrom is not set (#150)', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            const refreshOnlyWithChallenge = {
                refreshOn: [401],
                onChallenge: async () => {},
            } as unknown as SessionAuthConfig;

            try {
                resolveRefreshWiring({ sessionAuth: refreshOnlyWithChallenge }, undefined);
                expect(warnSpy).toHaveBeenCalledTimes(1);
                const message = warnSpy.mock.calls[0]![0] as string;
                expect(message).toContain('onChallenge');
                expect(message).not.toContain('injected from');
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('attributes only the injected onChallenge key when mixed with a typo\'d key (#150)', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            const mixedSessionAuth = {
                refreshOn: [401],
                onChallenge: async () => {},
                sessions: { endpoint: '/session' },
            } as unknown as SessionAuthConfig;

            try {
                resolveRefreshWiring(
                    { sessionAuth: mixedSessionAuth, onChallengeInjectedFrom: '.apijack/auth.ts' },
                    undefined,
                );
                expect(warnSpy).toHaveBeenCalledTimes(1);
                const message = warnSpy.mock.calls[0]![0] as string;
                expect(message).toContain('onChallenge (injected from .apijack/auth.ts)');
                expect(message).toContain('sessions');
                expect(message).not.toContain('sessions (injected from');
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('names a key whose value is explicit null (#150)', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            const explicitNullSessionAuth = {
                refreshOn: [401],
                cookies: null,
            } as unknown as SessionAuthConfig;

            try {
                resolveRefreshWiring({ sessionAuth: explicitNullSessionAuth }, undefined);
                expect(warnSpy).toHaveBeenCalledTimes(1);
                const message = warnSpy.mock.calls[0]![0] as string;
                expect(message).toContain('cookies');
            } finally {
                warnSpy.mockRestore();
            }
        });

        test('names a key whose explicit null arrives via the envConfig merge path (#150)', () => {
            const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
            // A JSON env config can carry `"cookies": null`; deepMerge's scalar
            // branch assigns it, so it must survive the merge and be named.
            const refreshOnlySessionAuth = { refreshOn: [401] } as unknown as SessionAuthConfig;
            const envConfigWithNull = { sessionAuth: { cookies: null } } as unknown as
                Parameters<typeof resolveRefreshWiring>[1];

            try {
                resolveRefreshWiring({ sessionAuth: refreshOnlySessionAuth }, envConfigWithNull);
                expect(warnSpy).toHaveBeenCalledTimes(1);
                const message = warnSpy.mock.calls[0]![0] as string;
                expect(message).toContain('cookies');
            } finally {
                warnSpy.mockRestore();
            }
        });
    });
});
