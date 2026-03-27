import type { AuthStrategy, AuthSession, ResolvedAuth } from './types';

export class BasicAuthStrategy implements AuthStrategy {
    async authenticate(config: ResolvedAuth): Promise<AuthSession> {
        return {
            headers: {
                Authorization: 'Basic ' + btoa(`${config.username}:${config.password}`),
            },
        };
    }

    async restore(cached: AuthSession): Promise<AuthSession | null> {
        return cached;
    }
}
