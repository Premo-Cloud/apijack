import type { AuthStrategy, AuthSession, ResolvedAuth } from './types';

export class BearerTokenStrategy implements AuthStrategy {
    constructor(private getToken: (config: ResolvedAuth) => Promise<string>) {}

    async authenticate(config: ResolvedAuth): Promise<AuthSession> {
        const token = await this.getToken(config);
        return { headers: { Authorization: `Bearer ${token}` } };
    }

    async restore(cached: AuthSession, config: ResolvedAuth): Promise<AuthSession | null> {
        if (cached.expiresAt && Date.now() > cached.expiresAt) return null;
        return cached;
    }

    async refresh(session: AuthSession, config: ResolvedAuth): Promise<AuthSession> {
        return this.authenticate(config);
    }
}
