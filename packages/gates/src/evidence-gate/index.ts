/**
 * Gate `evidence` (Evidence tests): Cited excerpts appear in the fetched source; quoted original-language words occur in that verse.
 *
 * Stub created by L-023 so the registry, runner and CLI work end to end. L-025 replaces this file
 * (keeping the `evidenceGate` export) and adds the gate's rules.
 */
import type { Gate } from '../core/gate.ts';
import { skippedResult } from '../core/result.ts';

export const evidenceGate: Gate = {
  id: 'evidence',
  title: 'Evidence tests',
  rules: [],
  run: () => skippedResult('evidence', 'not implemented (L-025)'),
};
