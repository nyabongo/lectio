/**
 * Gate 4 (LLM verifiers, L-027) over the repository content.
 *
 * The named rule tests run the registry gate as CI does without API keys: `config.verifiers.mode`
 * is `auto` and the provider set holds only fakes, so the gate is skipped and reports nothing
 * (the merge rule then requires review). The scenarios below run the gate over the real seed
 * passage with scripted fake verifiers (`mode: fake`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { createContext, renderComment, ruleBookFor, runGates } from '@lectio/gates';
import type { GateReport, GateResult } from '@lectio/gates';
import { FakeLlmClient, createProviders } from '@lectio/providers';
import type { FakeLlmScript, FakeLlmScriptEntry } from '@lectio/providers';
import { validatePassage } from '@lectio/schema/passage';

import { verifierGate } from '../../packages/gates/src/verifier-gate/index.ts';
import { REPO_ROOT, gateResult, gateTest } from './helpers/gate-test.ts';

const SEED = 'passages/MT.20.1-16.json';

gateTest('verifiers/two-families');
gateTest('verifiers/live-verifiers');
gateTest('verifiers/passage-readable');
gateTest('verifiers/claim-not-refuted');
gateTest('verifiers/verifier-answered', { allow: ['warning', 'info'] });
gateTest('verifiers/claim-supported', { allow: ['warning', 'info'] });
gateTest('verifiers/claim-not-sensitive', { allow: ['warning', 'info'] });
gateTest('verifiers/live-results', { allow: ['info'] });

const verdict = (value: Record<string, unknown> = {}): FakeLlmScript => ({
  patch: { verdict: 'supported', support: 0.97, sensitive: false, rationale: 'The cited source states it.', ...value },
});

async function runOnSeed(confirmer: FakeLlmScriptEntry, refuter: FakeLlmScriptEntry): Promise<GateReport> {
  const loaded = loadConfig(undefined, { cwd: REPO_ROOT });
  const config: LectioConfig = { ...loaded, verifiers: { ...loaded.verifiers, mode: 'fake' } };
  const context = createContext({
    root: REPO_ROOT,
    base: 'working-tree',
    head: 'working-tree',
    config,
    providers: createProviders(
      config,
      {},
      {
        confirmer: new FakeLlmClient({ roles: { confirmer } }),
        refuter: new FakeLlmClient({ roles: { refuter } }),
      },
    ),
    git: { changedFiles: () => [{ path: SEED, status: 'added' }], show: () => null },
  });
  return runGates([verifierGate], context);
}

const first = (report: GateReport): GateResult => report.results[0] as GateResult;

describe('gate 4 over the seed passage', () => {
  it('is skipped without live verifier clients (no API keys)', async () => {
    const result = await gateResult(verifierGate, [SEED]);
    expect(result.status).toBe('skipped');
  });

  it('passes when both fake verifiers support every claim, with a valid verifierSummary', async () => {
    const result = first(await runOnSeed(verdict(), verdict({ support: 0.93 })));
    expect(result.status).toBe('pass');
    const files = result.meta['files'] as Record<string, { verifierSummary: unknown }>;
    const summary = files[SEED]?.verifierSummary;
    expect(summary).toMatchObject({ minSupport: 0.93, refutations: 0, sensitive: 0 });
    const passage = JSON.parse(readFileSync(join(REPO_ROOT, SEED), 'utf8')) as object;
    const review = {
      status: 'approved',
      method: 'auto',
      reviewers: [],
      approvedVia: 'auto',
      lastReviewedAt: '2026-10-05T00:00:00Z',
      verifierSummary: summary,
    };
    expect(validatePassage({ ...passage, review })).toBe(true);
  });

  it('a refutation fails and the comment shows both verdicts', async () => {
    const report = await runOnSeed(verdict({ sensitive: true }), [
      verdict({ verdict: 'refuted', support: 0.15, rationale: 'The source does not say this.' }),
      verdict(),
    ]);
    expect(first(report).status).toBe('fail');
    const comment = renderComment(report, { gates: [verifierGate], rules: ruleBookFor([verifierGate]) });
    expect(comment).toContain('confirmer: supported 0.97; refuter: refuted 0.15');
    expect(comment).toContain('flagged sensitive by the confirmer');
  });
});
