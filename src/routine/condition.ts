import type { RoutineContext } from "./types";
import { resolveRef } from "./resolver";

export function evaluateCondition(expr: string | undefined, ctx: RoutineContext): boolean {
  if (expr === undefined || expr === null) return true;
  if (expr === "true") return true;
  if (expr === "false") return false;

  // Equality: $ref == value (RHS can also be a $ref)
  const eqMatch = expr.match(/^(\$[a-zA-Z_][a-zA-Z0-9_.\-]*)\s*==\s*(.+)$/);
  if (eqMatch) {
    const resolved = resolveRef(eqMatch[1]!.slice(1), ctx);
    const rhs = eqMatch[2]!.trim();
    const rhsValue = rhs.startsWith("$") ? String(resolveRef(rhs.slice(1), ctx)) : rhs;
    return String(resolved) === rhsValue;
  }

  // Inequality: $ref != value (RHS can also be a $ref)
  const neqMatch = expr.match(/^(\$[a-zA-Z_][a-zA-Z0-9_.\-]*)\s*!=\s*(.+)$/);
  if (neqMatch) {
    const resolved = resolveRef(neqMatch[1]!.slice(1), ctx);
    const rhs = neqMatch[2]!.trim();
    const rhsValue = rhs.startsWith("$") ? String(resolveRef(rhs.slice(1), ctx)) : rhs;
    return String(resolved) !== rhsValue;
  }

  // Truthy check: $ref
  const refMatch = expr.match(/^\$([a-zA-Z_][a-zA-Z0-9_.\-]*)$/);
  if (refMatch) {
    const resolved = resolveRef(refMatch[1]!, ctx);
    return !!resolved;
  }

  return !!expr;
}
