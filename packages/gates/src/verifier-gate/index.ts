/**
 * Gate `verifiers` (LLM verifiers): Two model families see only claims and sources: one confirms support, the other tries to refute.
 *
 * Stub created by L-023 so the registry, runner and CLI work end to end. L-027 replaces this file
 * (keeping the `verifierGate` export) and adds the gate's rules.
 */
import type { Gate } from '../core/gate.ts';
import { skippedResult } from '../core/result.ts';

export const verifierGate: Gate = {
  id: 'verifiers',
  title: 'LLM verifiers',
  rules: [],
  run: () => skippedResult('verifiers', 'not implemented (L-027)'),
};
