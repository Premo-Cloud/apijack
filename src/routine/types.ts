export interface RoutineStep {
  name: string;
  command?: string;
  args?: Record<string, string | number | boolean>;
  "args-positional"?: (string | number)[];
  output?: string;
  condition?: string;
  assert?: string;
  continueOnError?: boolean;
  forEach?: string;
  as?: string;
  steps?: RoutineStep[];
}

export interface RoutineDefinition {
  name: string;
  description?: string;
  variables?: Record<string, unknown>;
  steps: RoutineStep[];
}

export interface StepResult {
  name: string;
  success: boolean;
  output: unknown;
  error?: string;
}

export interface RoutineContext {
  variables: Record<string, unknown>;
  stepOutputs: Map<string, StepResult>;
  forEachItem?: { name: string; value: unknown };
}
