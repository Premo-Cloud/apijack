import type { RoutineDefinition, RoutineStep, RoutineContext, StepResult } from "./types";
import { resolveValue, resolveArgs, resolvePositionalArgs } from "./resolver";
import { evaluateCondition } from "./condition";
import type { CommandDispatcher } from "../types";

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
  options?: { dryRun?: boolean; onStep?: (step: RoutineStep, index: number, total: number) => void },
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
    if (typeof val === "string" && val.includes("$")) {
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

  async function runSteps(steps: RoutineStep[], parentCtx: RoutineContext): Promise<boolean> {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;

      if (!evaluateCondition(step.condition, parentCtx)) {
        stepsSkipped++;
        if (options?.onStep) options.onStep(step, i, steps.length);
        continue;
      }

      // forEach
      if (step.forEach && step.steps) {
        const items = resolveValue(step.forEach, parentCtx);
        if (!Array.isArray(items)) {
          process.stderr.write(`Warning: forEach on "${step.name}" did not resolve to an array\n`);
          stepsSkipped++;
          continue;
        }

        const asName = step.as || "item";
        for (const item of items) {
          const iterCtx: RoutineContext = {
            ...parentCtx,
            forEachItem: { name: asName, value: item },
          };
          const ok = await runSteps(step.steps, iterCtx);
          if (!ok && !step.continueOnError) return false;
        }
        continue;
      }

      if (!step.command) continue;

      if (options?.onStep) options.onStep(step, i, steps.length);

      const resolvedArgs = resolveArgs(step.args, parentCtx);
      const resolvedPositional = resolvePositionalArgs(step["args-positional"], parentCtx);

      if (options?.dryRun) {
        const argStr = Object.entries(resolvedArgs).map(([k, v]) => `${k} ${v}`).join(" ");
        const posStr = resolvedPositional.join(" ");
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
        const errMsg = err instanceof Error ? err.message : (typeof err === "object" && err !== null && "status" in err) ? `HTTP ${(err as any).status}: ${(err as any).body}` : String(err);
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
