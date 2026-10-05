/**
 * Gate 1 (schema, L-024) over the repository content: every passage and calendar year under the
 * content root, as if one pull request added them all. One named test per rule; a failure lists
 * each finding with the rule and how to fix it. `schema/note-ids-stable` compares against the
 * base branch, so here (every file counts as new) it checks only that the gate runs; its
 * fixture-base cases are unit tests in packages/gates/src/schema-gate.
 */
import { describe, expect, it } from 'vitest';

import { SCHEMA_RULES, schemaGate } from '../../packages/gates/src/schema-gate/index.ts';
import { contentFiles, gateResult, gateTest } from './helpers/gate-test.ts';

describe('gate 1: schema tests over the repository content', () => {
  for (const rule of Object.values(SCHEMA_RULES)) gateTest(rule.id);

  it('checks every content file, the seed passage included', async () => {
    const files = contentFiles();
    expect(files).toContain('passages/MT.20.1-16.json');
    const result = await gateResult(schemaGate);
    expect(result.meta).toEqual({ files: files.length });
    expect(result.status).toBe('pass');
  });
});
