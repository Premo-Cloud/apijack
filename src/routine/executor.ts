import type { RoutineDefinition, RoutineStep, RoutineContext, StepResult } from './types';
import { resolveValue, resolveArgs, resolvePositionalArgs, resetDistinctPools } from './resolver';
import { evaluateCondition } from './condition';
import type { CommandDispatcher } from '../types';

export interface RoutineResult {
    success: boolean;
    stepsRun: number;
    stepsSkipped: number;
    stepsFailed: number;
    error?: string;
}

export async function executeRoutine(
    routine: RoutineDefinition,
    overrides: Record<string, unknown>,
    dispatch: CommandDispatcher,
    options?: {
        dryRun?: boolean;
        onStep?: (step: RoutineStep, index: number, total: number) => void;
        onIteration?: (step: RoutineStep, current: number, total: number, stepIndex: number, stepTotal: number) => void;
    },
): Promise<RoutineResult> {
    const builtins: Record<string, unknown> = {
        _timestamp: Math.floor(Date.now() / 1000),
        _date: new Date().toISOString().slice(0, 10),
    };
    // Merge variables: builtins < routine defaults < overrides
    const rawVars = { ...builtins, ...routine.variables, ...overrides };
    // Resolve $references in default variable values (e.g. "run-$_timestamp")
    const REF = /\$([a-zA-Z_][a-zA-Z0-9_\-]*)/g;
    for (const [key, val] of Object.entries(rawVars)) {
        if (typeof val === 'string' && val.includes('$')) {
            rawVars[key] = val.replace(REF, (_, ref: string) => {
                const resolved = rawVars[ref];
                return resolved !== undefined ? String(resolved) : `$${ref}`;
            });
        }
    }
    const ctx: RoutineContext = {
        variables: rawVars,
        stepOutputs: new Map(),
    };

    let stepsRun = 0;
    let stepsSkipped = 0;
    let stepsFailed = 0;
    let inIteration = false;

    async function runSteps(steps: RoutineStep[], parentCtx: RoutineContext): Promise<boolean> {
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i]!;

            if (!evaluateCondition(step.condition, parentCtx)) {
                stepsSkipped++;
                if (options?.onStep && !inIteration) options.onStep(step, i, steps.length);
                continue;
            }

            // range — generates an array for iteration
            if (step.range && step.steps) {
                const [start, end] = step.range;
                let items = Array.from({ length: end - start + 1 }, (_, i) => i + start);
                if (step.shuffle) items = items.sort(() => Math.random() - 0.5);
                if (step.reverse) items = items.reverse();
                resetDistinctPools();
                const asName = step.as || 'item';
                inIteration = true;
                for (let j = 0; j < items.length; j++) {
                    if (options?.onIteration) options.onIteration(step, j + 1, items.length, i, steps.length);
                    const iterCtx: RoutineContext = {
                        ...parentCtx,
                        forEachItem: { name: asName, value: items[j] },
                    };
                    const ok = await runSteps(step.steps, iterCtx);
                    if (!ok && !step.continueOnError) {
                        inIteration = false;
                        return false;
                    }
                }
                inIteration = false;
                if (options?.onIteration) process.stderr.write('\n');
                continue;
            }

            // forEach
            if (step.forEach && step.steps) {
                const rawItems = resolveValue(step.forEach, parentCtx);
                if (!Array.isArray(rawItems)) {
                    process.stderr.write(`Warning: forEach on "${step.name}" did not resolve to an array\n`);
                    stepsSkipped++;
                    continue;
                }

                let items = [...rawItems];
                if (step.shuffle) items = items.sort(() => Math.random() - 0.5);
                if (step.reverse) items = items.reverse();

                // Reset distinct pools for each forEach block
                resetDistinctPools();

                const asName = step.as || 'item';
                inIteration = true;
                for (let j = 0; j < items.length; j++) {
                    if (options?.onIteration) options.onIteration(step, j + 1, items.length, i, steps.length);
                    const iterCtx: RoutineContext = {
                        ...parentCtx,
                        forEachItem: { name: asName, value: items[j] },
                    };
                    const ok = await runSteps(step.steps, iterCtx);
                    if (!ok && !step.continueOnError) {
                        inIteration = false;
                        return false;
                    }
                }
                inIteration = false;
                if (options?.onIteration) process.stderr.write('\n');
                continue;
            }

            if (!step.command) continue;

            if (options?.onStep && !inIteration) options.onStep(step, i, steps.length);

            const resolvedArgs = resolveArgs(step.args, parentCtx);
            const resolvedPositional = resolvePositionalArgs(step['args-positional'], parentCtx);

            if (options?.dryRun) {
                const argStr = Object.entries(resolvedArgs).map(([k, v]) => `${k} ${v}`).join(' ');
                const posStr = resolvedPositional.join(' ');
                console.log(`[${stepsRun + 1}] ${step.name}: ${step.command} ${posStr} ${argStr}`.trim());
                stepsRun++;
                continue;
            }

            try {
                const result = await dispatch(step.command, resolvedArgs, resolvedPositional);
                const stepResult: StepResult = { name: step.name, success: true, output: result };
                parentCtx.stepOutputs.set(step.name, stepResult);
                if (step.output) parentCtx.stepOutputs.set(step.output, stepResult);
                stepsRun++;

                // Evaluate assert after successful execution
                if (step.assert) {
                    const passed = evaluateCondition(step.assert, parentCtx);
                    if (!passed) {
                        console.error(`Assert failed on "${step.name}": ${step.assert}`);
                        stepResult.success = false;
                        stepResult.error = `Assertion failed: ${step.assert}`;
                        stepsFailed++;
                        if (!step.continueOnError) return false;
                    }
                }
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'status' in err) ? `HTTP ${(err as any).status}: ${(err as any).body}` : String(err);
                const stepResult: StepResult = { name: step.name, success: false, output: null, error: errMsg };
                parentCtx.stepOutputs.set(step.name, stepResult);
                if (step.output) parentCtx.stepOutputs.set(step.output, stepResult);
                stepsFailed++;
                stepsRun++;
                console.error(`Step "${step.name}" failed: ${errMsg}`);

                if (!step.continueOnError) return false;
            }
        }
        return true;
    }

    const ok = await runSteps(routine.steps, ctx);

    return {
        success: ok && stepsFailed === 0,
        stepsRun,
        stepsSkipped,
        stepsFailed,
    };
}
