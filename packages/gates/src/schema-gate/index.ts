/**
 * Gate `schema` (Schema tests): Every file validates, every claim has a source, every reference parses to a real verse.
 *
 * Stub created by L-023 so the registry, runner and CLI work end to end. L-024 replaces this file
 * (keeping the `schemaGate` export) and adds the gate's rules.
 */
import type { Gate } from '../core/gate.ts';
import { skippedResult } from '../core/result.ts';

export const schemaGate: Gate = {
  id: 'schema',
  title: 'Schema tests',
  rules: [],
  run: () => skippedResult('schema', 'not implemented (L-024)'),
};
