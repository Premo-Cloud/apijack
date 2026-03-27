import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { homedir } from 'os';
import type { AuthStrategy, AuthSession, ResolvedAuth } from './auth/types';

export class SessionManager {
    private sessionPath: string;

    constructor(cliName: string, sessionPathOverride?: string) {
        this.sessionPath
            = sessionPathOverride ?? `${homedir()}/.${cliName}/session.json`;
    }

    async resolve(
        strategy: AuthStrategy,
        config: ResolvedAuth,
    ): Promise<AuthSession> {
        const cached = this.load();

        if (cached) {
            if (cached.expiresAt && Date.now() > cached.expiresAt) {
                if (strategy.refresh) {
                    const refreshed = await strategy.refresh(cached, config);
                    this.save(refreshed);
                    return refreshed;
                }
                // Expired with no refresh — fall through to re-authenticate
            } else {
                const restored = await strategy.restore(cached, config);
                if (restored) {
                    this.save(restored);
                    return restored;
                }
                // restore() returned null — fall through to re-authenticate
            }
        }

        const session = await strategy.authenticate(config);
        this.save(session);
        return session;
    }

    invalidate(): void {
        try {
            unlinkSync(this.sessionPath);
        } catch {
            // File may not exist — that's fine
        }
    }

    private load(): AuthSession | null {
        try {
            if (!existsSync(this.sessionPath)) return null;
            return JSON.parse(readFileSync(this.sessionPath, 'utf-8'));
        } catch {
            return null;
        }
    }

    private save(session: AuthSession): void {
        mkdirSync(dirname(this.sessionPath), { recursive: true });
        writeFileSync(
            this.sessionPath,
            JSON.stringify(session, null, 2) + '\n',
        );
    }
}
