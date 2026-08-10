import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Command } from 'commander';

export type AliasMap = Record<string, string>;

export interface LoadedAliases {
    map: AliasMap;
    errors: string[];
}

/**
 * Load alias definitions from `<configDir>/aliases.json` and `~/.<cliName>/aliases.json`.
 * Project-local entries override global entries on conflict.
 */
export function loadAliases(configDir: string, cliName: string): LoadedAliases {
    const errors: string[] = [];
    const globalPath = join(homedir(), '.' + cliName, 'aliases.json');
    const projectPath = join(configDir, 'aliases.json');

    const global = readAliasFile(globalPath, errors);
    const project = projectPath === globalPath ? {} : readAliasFile(projectPath, errors);

    return { map: { ...global, ...project }, errors };
}

function readAliasFile(path: string, errors: string[]): AliasMap {
    if (!existsSync(path)) return {};

    let raw: string;
    try {
        raw = readFileSync(path, 'utf-8');
    } catch (e) {
        errors.push(`${path}: failed to read (${(e as Error).message})`);

        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        errors.push(`${path}: malformed JSON (${(e as Error).message})`);

        return {};
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push(`${path}: expected a JSON object mapping alias to canonical command`);

        return {};
    }

    const out: AliasMap = {};

    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== 'string') {
            errors.push(`${path}: alias "${k}" must map to a string`);
            continue;
        }

        const alias = k.trim();
        const expansion = v.trim();

        if (!alias || !expansion) {
            errors.push(`${path}: alias keys and values must be non-empty`);
            continue;
        }

        out[alias] = expansion;
    }

    return out;
}

/**
 * Best-effort longest-prefix resolution of leading argv tokens through the
 * alias map, without validating against the real command tree.
 *
 * Used for early bootstrap reads of argv[2]/argv[3] (auth-skip detection,
 * plugins-check guard, dry-run heuristic) that happen before the Commander
 * tree is built. The full validated rewrite happens later via `rewriteArgv`.
 *
 * If an alias key collides with a real command, this helper still applies the
 * alias — but the late `rewriteArgv` pass will detect the shadow and skip the
 * rewrite for actual execution. The early reads only care about a few
 * built-in command names, where shadowing is highly unlikely in practice.
 */
export function resolveLeadingTokens(args: string[], aliases: AliasMap): string[] {
    const keys = Object.keys(aliases);

    if (args.length === 0 || keys.length === 0) return args;

    const sortedAliases = keys.slice().sort((a, b) => {
        const aTokens = a.split(/\s+/).length;
        const bTokens = b.split(/\s+/).length;

        if (aTokens !== bTokens) return bTokens - aTokens;

        return b.length - a.length;
    });

    for (const alias of sortedAliases) {
        const tokens = alias.split(/\s+/);

        if (args.length < tokens.length) continue;

        let matches = true;

        for (let i = 0; i < tokens.length; i++) {
            if (args[i] !== tokens[i]) {
                matches = false;
                break;
            }
        }

        if (matches) {
            const expansion = aliases[alias].split(/\s+/);

            return [...expansion, ...args.slice(tokens.length)];
        }
    }

    return args;
}

/**
 * Walk the Commander program tree and collect every canonical command path
 * (space-separated tokens, e.g. "customers get-all-customers").
 */
export function collectCommandPaths(program: Command): Set<string> {
    const paths = new Set<string>();

    function walk(cmd: Command, prefix: string[]): void {
        const here = [...prefix, cmd.name()];
        paths.add(here.join(' '));

        for (const sub of cmd.commands) walk(sub, here);
    }

    for (const sub of program.commands) walk(sub, []);

    return paths;
}

export interface RewriteResult {
    rewrittenArgs: string[];
    warnings: string[];
    errors: string[];
}

/**
 * Apply alias rewriting to the user-supplied portion of argv (everything after
 * the node binary and script path).
 *
 * - Aliases that match a real command path are skipped (warning emitted, real
 *   command keeps winning).
 * - Aliases whose expansion does not resolve to a real command path are skipped
 *   (error emitted, CLI continues without the alias) -- unless
 *   `opts.generatedCommandsPresent` is `false`, in which case they are skipped
 *   silently, since there is nothing meaningful to validate against before
 *   `generate` has run.
 * - Longest-prefix wins: multi-token aliases are matched before shorter ones.
 * - Trailing args (positional and flags) are appended verbatim.
 */
export function rewriteArgv(
    args: string[],
    aliases: AliasMap,
    realPaths: Set<string>,
    opts?: { generatedCommandsPresent?: boolean },
): RewriteResult {
    const generatedCommandsPresent = opts?.generatedCommandsPresent ?? true;
    const warnings: string[] = [];
    const errors: string[] = [];
    const valid = new Map<string, string[]>();

    for (const [alias, expansion] of Object.entries(aliases)) {
        if (realPaths.has(alias)) {
            warnings.push(
                `alias "${alias}" shadows a real command and will be ignored`,
            );
            continue;
        }

        if (!realPaths.has(expansion)) {
            if (generatedCommandsPresent) {
                errors.push(
                    `alias "${alias}" → "${expansion}" does not resolve to a known command`,
                );
            }

            continue;
        }

        valid.set(alias, expansion.split(/\s+/));
    }

    if (args.length === 0 || valid.size === 0) {
        return { rewrittenArgs: args, warnings, errors };
    }

    const sortedAliases = [...valid.keys()].sort((a, b) => {
        const aTokens = a.split(/\s+/).length;
        const bTokens = b.split(/\s+/).length;

        if (aTokens !== bTokens) return bTokens - aTokens;

        return b.length - a.length;
    });

    for (const alias of sortedAliases) {
        const tokens = alias.split(/\s+/);

        if (args.length < tokens.length) continue;

        let matches = true;

        for (let i = 0; i < tokens.length; i++) {
            if (args[i] !== tokens[i]) {
                matches = false;
                break;
            }
        }

        if (matches) {
            const expansion = valid.get(alias)!;
            const tail = args.slice(tokens.length);

            return {
                rewrittenArgs: [...expansion, ...tail],
                warnings,
                errors,
            };
        }
    }

    return { rewrittenArgs: args, warnings, errors };
}
