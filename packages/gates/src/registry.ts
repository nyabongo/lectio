/**
 * The five gates, in run order. Each lives in `src/<gate>/index.ts`; L-024 to L-028 replace
 * their own stub without touching this file.
 */
import type { Gate } from './core/gate.ts';
import { RUNNER_GATE_ID, RUNNER_RULES, createRuleBook } from './core/rules.ts';
import type { RuleBook } from './core/rules.ts';
import { evidenceGate } from './evidence-gate/index.ts';
import { licenceGate } from './licence-gate/index.ts';
import { mergeRuleGate } from './merge-rule/index.ts';
import { schemaGate } from './schema-gate/index.ts';
import { verifierGate } from './verifier-gate/index.ts';

export const GATE_IDS = ['schema', 'evidence', 'licence', 'verifiers', 'merge-rule'] as const;
export type GateId = (typeof GATE_IDS)[number];

/** Every gate, in run order (cheap deterministic gates first, then the verifiers, then the merge rule). */
export const GATES: readonly Gate[] = [schemaGate, evidenceGate, licenceGate, verifierGate, mergeRuleGate];

/** The gates named by `ids`, in registry order; throws on an unknown id. */
export function selectGates(ids: readonly string[], gates: readonly Gate[] = GATES): Gate[] {
  const known = new Set(gates.map((gate) => gate.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new RangeError(`unknown gate ${unknown.join(', ')} (known: ${[...known].join(', ')})`);
  }
  return gates.filter((gate) => ids.includes(gate.id));
}

/** Every rule of `gates` plus the runner's own; each gate may only declare rules under its id. */
export function ruleBookFor(gates: readonly Gate[] = GATES): RuleBook {
  const owners = new Set([RUNNER_GATE_ID, ...gates.map((gate) => gate.id)]);
  return createRuleBook([...Object.values(RUNNER_RULES), ...gates.flatMap((gate) => gate.rules)], owners);
}

/** Every rule of the five gates, for failure messages and the gate docs (L-043). */
export function allRules(): RuleBook {
  return ruleBookFor(GATES);
}
