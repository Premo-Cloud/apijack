import { existsSync, readFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { ResolvedAuth } from './auth/types';

/**
 * Multi-environment config stored at ~/.<cliName>/config.json
 *
 * Format:
 * {
 *   "active": "staging",
 *   "environments": {
 *     "local": { "url": "http://localhost:8080", "user": "admin", "password": "..." },
 *     "staging": { "url": "https://staging.example.com", "user": "...", "password": "...", ... }
 *   }
 * }
 */

export interface CliConfig {
    active: string;
    environments: Record<string, EnvironmentConfig>;
}

export interface EnvironmentConfig {
    url: string;
    user: string;
    password: string;
    [key: string]: unknown;
}

interface ConfigOpts {
    configPath?: string;
}

function defaultConfigPath(cliName: string): string {
    return join(homedir(), `.${cliName}`, 'config.json');
}

function resolveConfigPath(cliName: string, opts?: ConfigOpts): string {
    return opts?.configPath ?? defaultConfigPath(cliName);
}

/**
 * Resolve authentication credentials.
 * Priority: environment variables > config file.
 *
 * Env var prefix is derived from cliName.toUpperCase():
 *   e.g. cliName="myapp" -> MYAPP_URL, MYAPP_USER, MYAPP_PASS
 */
export function resolveAuth(
    cliName: string,
    opts?: ConfigOpts,
): ResolvedAuth | null {
    const prefix = cliName.toUpperCase();
    const envUrl = process.env[`${prefix}_URL`];
    const envUser = process.env[`${prefix}_USER`];
    const envPass = process.env[`${prefix}_PASS`];

    if (envUrl && envUser && envPass) {
        return {
            baseUrl: envUrl,
            username: envUser,
            password: envPass,
        };
    }

    const configPath = resolveConfigPath(cliName, opts);
    const env = loadActiveEnvSync(configPath);
    if (env) {
        return {
            baseUrl: env.url,
            username: env.user,
            password: env.password,
        };
    }

    return null;
}

/**
 * Load the active environment config synchronously.
 * Returns the full environment object (including extra fields) or null.
 */
function loadActiveEnvSync(path: string): EnvironmentConfig | null {
    try {
        if (!existsSync(path)) return null;
        const text = readFileSync(path, 'utf-8');
        const config = JSON.parse(text) as CliConfig;
        if (!config.active || !config.environments?.[config.active]) return null;
        return config.environments[config.active];
    } catch {
        return null;
    }
}

/**
 * Get the full active environment config object (including extra fields).
 * Synchronous read.
 */
export function getActiveEnvConfig(
    cliName: string,
    opts?: ConfigOpts,
): EnvironmentConfig | null {
    const configPath = resolveConfigPath(cliName, opts);
    return loadActiveEnvSync(configPath);
}

/**
 * Load the full config file asynchronously.
 */
export async function loadConfig(
    cliName: string,
    opts?: ConfigOpts,
): Promise<CliConfig | null> {
    const configPath = resolveConfigPath(cliName, opts);
    try {
        const file = Bun.file(configPath);
        if (!(await file.exists())) return null;
        const raw = await file.json();
        return raw as CliConfig;
    } catch {
        return null;
    }
}

/**
 * Save (create or update) an environment in the config file.
 *
 * @param cliName - CLI name used to derive config path
 * @param name - Environment name (e.g. "local", "staging")
 * @param env - Environment config; must contain url, user, password; may contain extra fields
 * @param setActive - Whether to set this environment as active (default: true)
 * @param opts - Override config path for testing
 */
export async function saveEnvironment(
    cliName: string,
    name: string,
    env: Record<string, unknown> & { url: string; user: string; password: string },
    setActive: boolean = true,
    opts?: ConfigOpts,
): Promise<void> {
    const configPath = resolveConfigPath(cliName, opts);
    const config = (await loadConfig(cliName, opts)) || {
        active: '',
        environments: {},
    };

    config.environments[name] = env as EnvironmentConfig;
    if (setActive) config.active = name;

    const dir = dirname(configPath);
    await mkdir(dir, { recursive: true });
    await Bun.write(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Switch the active environment.
 * Returns true on success, false if the environment doesn't exist.
 */
export async function switchEnvironment(
    cliName: string,
    name: string,
    opts?: ConfigOpts,
): Promise<boolean> {
    const configPath = resolveConfigPath(cliName, opts);
    const config = await loadConfig(cliName, opts);
    if (!config || !config.environments[name]) return false;

    config.active = name;
    await Bun.write(configPath, JSON.stringify(config, null, 2) + '\n');
    return true;
}

/**
 * List all environments with their active status.
 */
export async function listEnvironments(
    cliName: string,
    opts?: ConfigOpts,
): Promise<{ name: string; url: string; user: string; active: boolean }[]> {
    const config = await loadConfig(cliName, opts);
    if (!config) return [];

    return Object.entries(config.environments).map(([name, env]) => ({
        name,
        url: env.url,
        user: env.user,
        active: name === config.active,
    }));
}

/**
 * Set an arbitrary field on the active environment.
 * Does nothing if no config exists or no active environment is set.
 */
export async function updateEnvironmentField(
    cliName: string,
    fieldName: string,
    value: unknown,
    opts?: ConfigOpts,
): Promise<void> {
    const configPath = resolveConfigPath(cliName, opts);
    const config = await loadConfig(cliName, opts);
    if (!config || !config.active) return;

    const env = config.environments[config.active];
    if (!env) return;

    (env as Record<string, unknown>)[fieldName] = value;
    await Bun.write(configPath, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Verify credentials by making an HTTP HEAD request to the OpenAPI spec endpoint.
 */
export async function verifyCredentials(
    url: string,
    user: string,
    password: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
    const headers = {
        Authorization: 'Basic ' + btoa(`${user}:${password}`),
    };
    try {
        const res = await fetch(`${url}/v3/api-docs`, { headers, method: 'HEAD' });
        if (!res.ok) {
            return { ok: false, reason: `Authentication failed: ${res.status}` };
        }
        return { ok: true };
    } catch {
        return { ok: false, reason: `Could not reach ${url} — server may be down.` };
    }
}
