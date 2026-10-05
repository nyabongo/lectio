import { describe, expect, it } from 'vitest';

import { GATES, runGates, skipReason } from '@lectio/gates';

import { dummyGate } from '../../../packages/gates/src/core/fixtures/dummy-gate.ts';
import { contentContext, contentFiles, gateResult, gateTest } from './gate-test.ts';

describe('gateTest over the repository content', () => {
  // The dummy gate's rules hold for the real content (no claim without a source, and so on).
  gateTest('dummy/claim-cites-source', { gate: dummyGate });
  gateTest('dummy/summary-short', { gate: dummyGate, allow: ['warning', 'info'] });

  // A rule of a gate that is still an L-023 stub registers as skipped until its issue lands.
  gateTest('schema/claim-has-source');

  it('rejects unknown gates and undeclared rules', () => {
    expect(() => {
      gateTest('nope/rule');
    }).toThrow('gateTest: no gate "nope" for rule nope/rule');
    expect(() => {
      gateTest('dummy/not-declared', { gate: dummyGate });
    }).toThrow('gateTest: gate "dummy" declares no rule dummy/not-declared');
  });

  it('lists content files under the configured root and caches gate runs', async () => {
    for (const file of contentFiles()) expect(file).toMatch(/^(calendar|passages)\/[^/]+\.json$/);
    expect(gateResult(dummyGate)).toBe(gateResult(dummyGate));
    expect((await gateResult(dummyGate, [])).status).toBe('pass');
  });

  it('every registry stub reports skipped over the real content', async () => {
    const stubs = GATES.filter((gate) => gate.rules.length === 0);
    const report = await runGates(stubs, contentContext());
    for (const result of report.results) {
      expect(result.status).toBe('skipped');
      expect(skipReason(result)).toMatch(/^not implemented \(L-02[4-8]\)$/);
    }
  });
});
