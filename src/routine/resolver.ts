import type { RoutineContext } from './types';

const REF_PATTERN = /\$([a-zA-Z_][a-zA-Z0-9_\-]*(?:\.[a-zA-Z0-9_][a-zA-Z0-9_\-]*)*)/g;
const FUNC_PATTERN = /\$(_random_hex_color|_uuid|_random_int|_random_from|_random_distinct_from)(?:\(([^)]*)\))?/g;

// ── Built-in functions ─────────────────────────────────────────────

// Tracks distinct pool state per expression across iterations
const distinctPools = new Map<string, unknown[]>();

export function resetDistinctPools(): void {
    distinctPools.clear();
}

function evalBuiltinFunc(name: string, argsStr?: string): unknown {
    switch (name) {
        case '_random_hex_color': {
            const hex = Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
            return `#${hex}`;
        }
        case '_uuid':
            return crypto.randomUUID();
        case '_random_int': {
            if (!argsStr) return 0;
            const [minStr, maxStr] = argsStr.split(',').map(s => s.trim());
            const min = parseInt(minStr, 10);
            const max = parseInt(maxStr, 10);
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }
        case '_random_from': {
            if (!argsStr) return '';
            const options = argsStr.split(',').map(s => s.trim());
            return options[Math.floor(Math.random() * options.length)];
        }
        case '_random_distinct_from': {
            if (!argsStr) return '';
            const poolKey = argsStr;
            let pool = distinctPools.get(poolKey);
            if (!pool || pool.length === 0) {
            // Reshuffle and refill
                const items = argsStr.split(',').map(s => s.trim());
                pool = [...items].sort(() => Math.random() - 0.5);
                distinctPools.set(poolKey, pool);
            }
            return pool.pop()!;
        }
        default:
            return undefined;
    }
}

function getByDotPath(obj: unknown, path: string[]): unknown {
    let current = obj;
    for (const key of path) {
        if (current == null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

export function resolveRef(ref: string, ctx: RoutineContext): unknown {
    const parts = ref.split('.');
    const root = parts[0]!;
    const rest = parts.slice(1);

    // 1. forEach item variable
    if (ctx.forEachItem && ctx.forEachItem.name === root) {
        return rest.length > 0 ? getByDotPath(ctx.forEachItem.value, rest) : ctx.forEachItem.value;
    }

    // 2. Step output
    const step = ctx.stepOutputs.get(root);
    if (step) {
        if (rest.length === 0) return step.output;
        if (rest[0] === 'success') return step.success;
        return getByDotPath(step.output, rest);
    }

    // 3. Top-level variables
    if (root in ctx.variables) {
        const val = ctx.variables[root];
        return rest.length > 0 ? getByDotPath(val, rest) : val;
    }

    return undefined;
}

export function resolveValue(value: unknown, ctx: RoutineContext): unknown {
    if (typeof value !== 'string') return value;
    if (!value.includes('$')) return value;

    // Exact match: built-in function (no args)
    const funcExact = value.match(/^\$(_random_hex_color|_uuid)$/);
    if (funcExact) {
        return evalBuiltinFunc(funcExact[1]!);
    }

    // Exact match: built-in function with args
    const funcCall = value.match(/^\$(_random_int|_random_from|_random_distinct_from)\(([^)]*)\)$/);
    if (funcCall) {
        return evalBuiltinFunc(funcCall[1]!, funcCall[2]);
    }

    // Exact match: entire value is a single $ref — resolve to native type
    const match = value.match(/^\$([a-zA-Z_][a-zA-Z0-9_\-]*(?:\.[a-zA-Z0-9_][a-zA-Z0-9_\-]*)*)$/);
    if (match) {
        return resolveRef(match[1]!, ctx);
    }

    // Inline interpolation: resolve $refs and functions embedded in the string
    return resolveString(value, ctx);
}

export function resolveString(str: string, ctx: RoutineContext): string {
    // First resolve built-in functions
    let result = str.replace(FUNC_PATTERN, (_match, name: string, argsStr?: string) => {
        const resolved = evalBuiltinFunc(name, argsStr);
        return resolved !== undefined ? String(resolved) : _match;
    });
    // Then resolve variable references
    result = result.replace(REF_PATTERN, (_match, ref: string) => {
        const resolved = resolveRef(ref, ctx);
        if (resolved === undefined) {
            process.stderr.write(`Warning: unresolved reference $${ref}\n`);
            return '';
        }
        return String(resolved);
    });
    return result;
}

export function resolveArgs(
    args: Record<string, string | number | boolean> | undefined,
    ctx: RoutineContext,
): Record<string, unknown> {
    if (!args) return {};
    const resolved: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(args)) {
        resolved[key] = resolveValue(val, ctx);
    }
    return resolved;
}

export function resolvePositionalArgs(
    args: (string | number)[] | undefined,
    ctx: RoutineContext,
): unknown[] {
    if (!args) return [];
    return args.map(a => resolveValue(a, ctx));
}
