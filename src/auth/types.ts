export interface AuthStrategy {
    authenticate(config: ResolvedAuth): Promise<AuthSession>;
    restore(cached: AuthSession, config: ResolvedAuth): Promise<AuthSession | null>;
    refresh?(session: AuthSession, config: ResolvedAuth): Promise<AuthSession>;
}

export interface AuthSession {
    headers: Record<string, string>;
    expiresAt?: number;
    data?: Record<string, unknown>;
}

export interface ResolvedAuth {
    baseUrl: string;
    username: string;
    password: string;
}
