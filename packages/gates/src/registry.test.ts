import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { createProviders } from '@lectio/providers';
import { validateGateResult } from '@lectio/schema/gate-result';

import { DUMMY_RULES, dummyGate } from './core/fixtures/dummy-gate.ts';
import { createContext } from './core/gate.ts';
import { createGit } from './core/git.ts';
import { skipReason } from './core/result.ts';
import { RUNNER_RULES, defineRule } from './core/rules.ts';
import { runGates } from './core/runner.ts';
import { GATES, GATE_IDS, allRules, ruleBookFor, selectGates } from './registry.ts';

describe('registry', () => {
  it('lists the five gates in run order', () => {
    expect(GATES.map((gate) => gate.id)).toEqual([...GATE_IDS]);
    expect(GATE_IDS).toEqual(['schema', 'evidence', 'licence', 'verifiers', 'merge-rule']);
    for (const gate of GATES) expect(gate.title).not.toBe('');
  });

  // A gate still on its L-023 stub declares no rules and reports `skipped`. When L-024 to L-028
  // replace a stub (and declare rules), it drops out of this check.
  it('every stub reports skipped: not implemented (L-0NN)', async () => {
    const context = createContext({
      root: '/repo',
      base: 'origin/main',
      head: 'HEAD',
      config: DEFAULT_CONFIG,
      providers: createProviders(DEFAULT_CONFIG),
      git: createGit('/repo', () => ''),
      readText: () => null,
    });
    const stubs = GATES.filter((gate) => gate.rules.length === 0);
    const report = await runGates(stubs, context);
    for (const result of report.results) {
      expect(validateGateResult(result)).toBe(true);
      expect(result.status).toBe('skipped');
      expect(skipReason(result)).toMatch(/^not implemented \(L-02[4-8]\)$/);
    }
  });

  it('selects gates by id in registry order and rejects unknown ids', () => {
    expect(selectGates(['licence', 'schema']).map((gate) => gate.id)).toEqual(['schema', 'licence']);
    expect(() => selectGates(['schema', 'nope'])).toThrow(
      'unknown gate nope (known: schema, evidence, licence, verifiers, merge-rule)',
    );
    expect(selectGates(['dummy'], [dummyGate])).toEqual([dummyGate]);
  });

  it('builds a rule book with the runner rules and each gate’s own rules', () => {
    const book = ruleBookFor([dummyGate]);
    expect(book.get(DUMMY_RULES.claimCited.id)).toBe(DUMMY_RULES.claimCited);
    expect(book.get(RUNNER_RULES.crashed.id)).toBe(RUNNER_RULES.crashed);
    for (const rule of Object.values(RUNNER_RULES)) expect(allRules().get(rule.id)).toBe(rule);
  });

  it('rejects a gate that declares another gate’s rule', () => {
    const rogue = { ...dummyGate, id: 'rogue', rules: [defineRule('schema/x', 'S.', 'F.')] };
    expect(() => ruleBookFor([rogue])).toThrow('rule schema/x does not belong to any of: runner, rogue');
  });
});
