/**
 * Gate `licence` (Licence guard): No long verbatim run from an English Bible translation or from a cited commentary.
 *
 * Stub created by L-023 so the registry, runner and CLI work end to end. L-026 replaces this file
 * (keeping the `licenceGate` export) and adds the gate's rules.
 */
import type { Gate } from '../core/gate.ts';
import { skippedResult } from '../core/result.ts';

export const licenceGate: Gate = {
  id: 'licence',
  title: 'Licence guard',
  rules: [],
  run: () => skippedResult('licence', 'not implemented (L-026)'),
};
