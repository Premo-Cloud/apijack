import yaml from 'js-yaml';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import type { RoutineDefinition, RoutineStep } from './types';

export function parseRoutine(content: string): RoutineDefinition {
    const doc = yaml.load(content) as Record<string, unknown>;
    if (!doc || typeof doc !== 'object') throw new Error('Invalid YAML');
    if (!doc.name || typeof doc.name !== 'string') throw new Error("Routine must have a 'name' field");
    if (!Array.isArray(doc.steps) || doc.steps.length === 0) throw new Error("Routine must have 'steps' array");

    return {
        name: doc.name,
        description: doc.description as string | undefined,
        variables: (doc.variables as Record<string, unknown>) || {},
        steps: doc.steps as RoutineStep[],
    };
}

export function validateRoutine(routine: RoutineDefinition): string[] {
    const errors: string[] = [];
    const names = new Set<string>();
    const aliases = new Set<string>();

    function validateSteps(steps: RoutineStep[], path: string) {
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i]!;
            const loc = `${path}[${i}] "${step.name}"`;

            if (!step.name) {
                errors.push(`Step ${path}[${i}] is missing 'name'`);
                continue;
            }

            if (names.has(step.name)) {
                errors.push(`Duplicate step name: "${step.name}" at ${loc}`);
            }
            if (aliases.has(step.name)) {
                errors.push(`Output alias collision: step name "${step.name}" collides with an output alias at ${loc}`);
            }
            names.add(step.name);

            if (step.output) {
                if (names.has(step.output) || aliases.has(step.output)) {
                    errors.push(`Output alias collision: "${step.output}" at ${loc}`);
                }
                aliases.add(step.output);
            }

            if (!step.command && !step.forEach && !step.range) {
                errors.push(`Step ${loc} must have 'command', 'forEach', or 'range'`);
            }

            if ((step.forEach || step.range) && step.steps) {
                validateSteps(step.steps, `${loc}.steps`);
            }
        }
    }

    validateSteps(routine.steps, 'steps');
    return errors;
}

/** Look up a routine name in an optional builtins map. Returns the YAML content or null. */
function resolveBuiltin(nameOrPath: string, builtinsMap?: Record<string, string>): string | null {
    if (!builtinsMap) return null;

    // Folder-based: <name>/routine.yaml
    const folderKey = `${nameOrPath}/routine.yaml`;
    if (builtinsMap[folderKey]) return builtinsMap[folderKey];

    // Flat file: <name>.yaml
    if (builtinsMap[`${nameOrPath}.yaml`]) return builtinsMap[`${nameOrPath}.yaml`];
    if (builtinsMap[`${nameOrPath}.yml`]) return builtinsMap[`${nameOrPath}.yml`];

    return null;
}

function resolveRoutinePath(
    nameOrPath: string,
    routinesDir: string,
    builtinsMap?: Record<string, string>,
): string | null {
    if (nameOrPath.endsWith('.yaml') || nameOrPath.endsWith('.yml')) {
        const p = resolve(nameOrPath);
        return existsSync(p) ? p : null;
    }

    // 1. User routines on disk take precedence
    const folderPath = resolve(routinesDir, nameOrPath, 'routine.yaml');
    if (existsSync(folderPath)) return folderPath;

    const flatPath = resolve(routinesDir, `${nameOrPath}.yaml`);
    if (existsSync(flatPath)) return flatPath;

    const flatYml = resolve(routinesDir, `${nameOrPath}.yml`);
    if (existsSync(flatYml)) return flatYml;

    // 2. Embedded builtins — return a sentinel so loadRoutineFile knows to use builtins
    if (resolveBuiltin(nameOrPath, builtinsMap)) return `__builtin__:${nameOrPath}`;

    return null;
}

export function loadRoutineFile(
    nameOrPath: string,
    routinesDir: string,
    builtinsMap?: Record<string, string>,
): RoutineDefinition {
    const filePath = resolveRoutinePath(nameOrPath, routinesDir, builtinsMap);

    if (!filePath) {
        const available = listRoutines(routinesDir, builtinsMap);
        const availStr = available.length > 0 ? `Available:\n${formatRoutineTree(available)}` : 'No routines found.';
        throw new Error(`Routine not found: ${nameOrPath}\n${availStr}`);
    }

    // Embedded builtin — read from the builtins map
    if (filePath.startsWith('__builtin__:')) {
        const name = filePath.slice('__builtin__:'.length);
        const content = resolveBuiltin(name, builtinsMap)!;
        return parseRoutine(content);
    }

    const content = readFileSync(filePath, 'utf-8');
    return parseRoutine(content);
}

export function loadSpecFile(
    nameOrPath: string,
    routinesDir: string,
    builtinsMap?: Record<string, string>,
): RoutineDefinition | null {
    // Check user dir first
    const specPath = resolve(routinesDir, nameOrPath, 'spec.yaml');
    if (existsSync(specPath)) {
        const content = readFileSync(specPath, 'utf-8');
        return parseRoutine(content);
    }

    // Then check embedded builtins
    if (builtinsMap) {
        const builtinSpec = builtinsMap[`${nameOrPath}/spec.yaml`];
        if (builtinSpec) return parseRoutine(builtinSpec);
    }

    return null;
}

function collectRoutines(dir: string, prefix: string = ''): string[] {
    if (!existsSync(dir)) return [];
    const results: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullName = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            // Folder-based routine: has routine.yaml inside
            if (existsSync(resolve(dir, entry.name, 'routine.yaml'))) {
                const hasSpec = existsSync(resolve(dir, entry.name, 'spec.yaml'));
                results.push(hasSpec ? `${fullName} \x1b[2m(has spec)\x1b[0m` : fullName);
            } else {
                // Nested group directory
                results.push(...collectRoutines(resolve(dir, entry.name), fullName));
            }
        } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
            // Flat file (backwards compat)
            const name = entry.name.replace(/\.ya?ml$/, '');
            results.push(prefix ? `${prefix}/${name}` : name);
        }
    }
    return results;
}

/** Collect routine names from an optional builtins map. */
function collectBuiltinRoutines(builtinsMap?: Record<string, string>): string[] {
    if (!builtinsMap) return [];
    const routines = new Set<string>();
    for (const key of Object.keys(builtinsMap)) {
    // Folder-based: "e2e/matter/create/routine.yaml" -> "e2e/matter/create"
        if (key.endsWith('/routine.yaml')) {
            const name = key.slice(0, -'/routine.yaml'.length);
            const hasSpec = `${name}/spec.yaml` in builtinsMap;
            routines.add(hasSpec ? `${name} \x1b[2m(has spec)\x1b[0m` : name);
        } else if (key.endsWith('.yaml') || key.endsWith('.yml')) {
            // Flat file: "smoke-test.yaml" -> "smoke-test" (skip if already covered by folder)
            const name = key.replace(/\.ya?ml$/, '');
            if (!routines.has(name) && !builtinsMap[`${name}/routine.yaml`]) {
                routines.add(name);
            }
        }
    }
    return [...routines];
}

export function listRoutines(
    routinesDir: string,
    builtinsMap?: Record<string, string>,
): string[] {
    const userRoutines = collectRoutines(routinesDir);
    const builtins = collectBuiltinRoutines(builtinsMap);

    // Merge: user routines take precedence (by cleaned name)
    const seen = new Set(userRoutines.map(r => r.replace(/\x1b\[[0-9;]*m/g, '').trim()));
    const merged = [...userRoutines];
    for (const r of builtins) {
        const clean = r.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!seen.has(clean)) {
            merged.push(r);
            seen.add(clean);
        }
    }
    return merged;
}

export function listRoutinesStructured(
    routinesDir: string,
): Array<{ name: string }> {
    try {
        const raw = listRoutines(routinesDir);
        return raw.map((r) => {
            let clean = r.replace(/\x1b\[[0-9;]*m/g, '');
            clean = clean.replace(/\s*\(has spec\)\s*$/, '');
            clean = clean.trim();
            return { name: clean };
        });
    } catch {
        return [];
    }
}

export function formatRoutineList(routines: string[], pathPrefix?: string): string {
    const cleaned = routines
        .map(r => r.replace(/\x1b\[[0-9;]*m/g, '').trim())
        .sort();

    // Group into top-level items and directories
    const topLevel: { name: string; desc?: string }[] = [];
    const dirs = new Map<string, number>();

    for (const r of cleaned) {
        const slash = r.indexOf('/');
        if (slash === -1) {
            topLevel.push({ name: r });
        } else {
            const dir = r.slice(0, slash);
            dirs.set(dir, (dirs.get(dir) || 0) + 1);
        }
    }

    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
    const lines: string[] = [];

    // Directories first
    for (const [dir, count] of [...dirs.entries()].sort()) {
        lines.push(`  ${dir}/  ${dim}${count} routine${count === 1 ? '' : 's'}${reset}`);
    }
    // Then top-level routines
    for (const { name } of topLevel) {
        lines.push(`  ${name}`);
    }

    return lines.join('\n');
}

interface TreeNode {
    name: string;
    description?: string;
    children: Map<string, TreeNode>;
    isRoutine: boolean;
}

function buildTree(routines: string[]): TreeNode {
    const root: TreeNode = { name: '', children: new Map(), isRoutine: false };

    for (const r of routines) {
    // Strip ANSI codes (e.g. "(has spec)" dim markers)
        const clean = r.replace(/\x1b\[[0-9;]*m/g, '').trim();
        const parts = clean.split('/');
        let node = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            if (!node.children.has(part)) {
                node.children.set(part, { name: part, children: new Map(), isRoutine: false });
            }
            node = node.children.get(part)!;
        }
        node.isRoutine = true;
    }

    return root;
}

export function formatRoutineTree(routines: string[]): string {
    const root = buildTree(routines.sort());
    const lines: string[] = [];
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';

    function render(node: TreeNode, prefix: string, isLast: boolean, isRoot: boolean) {
        if (!isRoot) {
            const connector = isLast ? '└── ' : '├── ';
            const label = node.isRoutine ? node.name : `${node.name}/`;
            const desc = node.description ? `  ${dim}${node.description}${reset}` : '';
            lines.push(`${prefix}${connector}${label}${desc}`);
        }

        const entries = [...node.children.values()];
        // Sort: directories first, then routines
        entries.sort((a, b) => {
            const aDir = a.children.size > 0 && !a.isRoutine ? 0 : 1;
            const bDir = b.children.size > 0 && !b.isRoutine ? 0 : 1;
            if (aDir !== bDir) return aDir - bDir;
            return a.name.localeCompare(b.name);
        });

        for (let i = 0; i < entries.length; i++) {
            const child = entries[i]!;
            const childIsLast = i === entries.length - 1;
            const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '│   ');
            render(child, childPrefix, childIsLast, false);
        }
    }

    render(root, '', true, true);
    return lines.join('\n');
}
