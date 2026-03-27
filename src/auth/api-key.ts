import type { AuthStrategy, AuthSession, ResolvedAuth } from './types';

export class ApiKeyStrategy implements AuthStrategy {
    constructor(private headerName: string, private apiKey: string) {}

    async authenticate(_config: ResolvedAuth): Promise<AuthSession> {
        return { headers: { [this.headerName]: this.apiKey } };
    }

    async restore(cached: AuthSession): Promise<AuthSession | null> {
        return cached;
    }
}
