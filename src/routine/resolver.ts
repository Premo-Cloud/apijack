import type { RoutineContext } from './types';

const REF_PATTERN = /\$([a-zA-Z_][a-zA-Z0-9_\-]*(?:\.[a-zA-Z0-9_][a-zA-Z0-9_\-]*)*)/g;

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

    // Exact match: entire value is a single $ref — resolve to native type
    const match = value.match(/^\$([a-zA-Z_][a-zA-Z0-9_\-]*(?:\.[a-zA-Z0-9_][a-zA-Z0-9_\-]*)*)$/);
    if (match) {
        return resolveRef(match[1]!, ctx);
    }

    // Inline interpolation: resolve $refs embedded in the string
    return resolveString(value, ctx);
}

export function resolveString(str: string, ctx: RoutineContext): string {
    return str.replace(REF_PATTERN, (_match, ref: string) => {
        const resolved = resolveRef(ref, ctx);
        if (resolved === undefined) {
            process.stderr.write(`Warning: unresolved reference $${ref}\n`);
            return '';
        }
        return String(resolved);
    });
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
