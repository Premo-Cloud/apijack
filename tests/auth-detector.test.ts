import { describe, test, expect } from 'bun:test';
import { detectAuthFromSpec, type SecurityScheme } from '../src/auth-detector';
import { BasicAuthStrategy } from '../src/auth/basic';

describe('detectAuthFromSpec()', () => {
    test('detects basic auth', () => {
        const schemes: Record<string, SecurityScheme> = {
            basicAuth: { type: 'http', scheme: 'basic' },
        };
        const result = detectAuthFromSpec(schemes);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('basic');
        expect(result!.strategy).toBeInstanceOf(BasicAuthStrategy);
    });

    test('detects bearer auth', () => {
        const schemes: Record<string, SecurityScheme> = {
            bearerAuth: { type: 'http', scheme: 'bearer' },
        };
        const result = detectAuthFromSpec(schemes);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('bearer');
    });

    test('detects apiKey auth with header name', () => {
        const schemes: Record<string, SecurityScheme> = {
            apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
        };
        const result = detectAuthFromSpec(schemes);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('apiKey');
        expect(result!.headerName).toBe('X-API-Key');
    });

    test('returns null for empty schemes', () => {
        const result = detectAuthFromSpec({});
        expect(result).toBeNull();
    });

    test('returns null for undefined schemes', () => {
        const result = detectAuthFromSpec(undefined);
        expect(result).toBeNull();
    });

    test('prefers basic auth when multiple schemes present', () => {
        const schemes: Record<string, SecurityScheme> = {
            apiKey: { type: 'apiKey', name: 'X-Key', in: 'header' },
            basicAuth: { type: 'http', scheme: 'basic' },
        };
        const result = detectAuthFromSpec(schemes);
        expect(result!.type).toBe('basic');
    });

    test('detects oauth2 as bearer type', () => {
        const schemes: Record<string, SecurityScheme> = {
            oauth: {
                type: 'oauth2',
                flows: {
                    clientCredentials: {
                        tokenUrl: 'https://auth.example.com/token',
                        scopes: {},
                    },
                },
            },
        };
        const result = detectAuthFromSpec(schemes);
        expect(result).not.toBeNull();
        expect(result!.type).toBe('bearer');
    });
});
