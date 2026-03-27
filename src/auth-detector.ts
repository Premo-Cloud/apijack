import type { AuthStrategy } from './auth/types';
import { BasicAuthStrategy } from './auth/basic';
import { BearerTokenStrategy } from './auth/bearer';
import { ApiKeyStrategy } from './auth/api-key';

export interface SecurityScheme {
    type: 'http' | 'apiKey' | 'oauth2' | 'openIdConnect';
    scheme?: string;
    name?: string;
    in?: string;
    flows?: Record<string, unknown>;
}

export interface DetectedAuth {
    type: 'basic' | 'bearer' | 'apiKey';
    strategy: AuthStrategy;
    headerName?: string;
}

const PRIORITY: Array<'basic' | 'bearer' | 'apiKey'> = ['basic', 'bearer', 'apiKey'];

export function detectAuthFromSpec(
    schemes: Record<string, SecurityScheme> | undefined,
): DetectedAuth | null {
    if (!schemes || Object.keys(schemes).length === 0) return null;

    const detected: DetectedAuth[] = [];

    for (const scheme of Object.values(schemes)) {
        if (scheme.type === 'http' && scheme.scheme === 'basic') {
            detected.push({
                type: 'basic',
                strategy: new BasicAuthStrategy(),
            });
        } else if (scheme.type === 'http' && scheme.scheme === 'bearer') {
            detected.push({
                type: 'bearer',
                strategy: new BearerTokenStrategy(async (config) => {
                    return config.password;
                }),
            });
        } else if (scheme.type === 'apiKey' && scheme.name && scheme.in === 'header') {
            detected.push({
                type: 'apiKey',
                strategy: new ApiKeyStrategy(scheme.name, ''),
                headerName: scheme.name,
            });
        } else if (scheme.type === 'oauth2') {
            detected.push({
                type: 'bearer',
                strategy: new BearerTokenStrategy(async (config) => {
                    return config.password;
                }),
            });
        }
    }

    if (detected.length === 0) return null;

    for (const prio of PRIORITY) {
        const match = detected.find(d => d.type === prio);
        if (match) return match;
    }

    return detected[0]!;
}

export async function fetchSecuritySchemes(
    specUrl: string,
    headers?: Record<string, string>,
): Promise<Record<string, SecurityScheme> | null> {
    try {
        const res = await fetch(specUrl, {
            headers: { Accept: 'application/json', ...headers },
        });
        if (!res.ok) return null;
        const spec = await res.json() as Record<string, unknown>;
        const components = spec.components as Record<string, unknown> | undefined;
        return (components?.securitySchemes as Record<string, SecurityScheme>) ?? null;
    } catch {
        return null;
    }
}
