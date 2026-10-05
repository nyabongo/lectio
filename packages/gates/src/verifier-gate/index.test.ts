import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { BudgetExceededError, FakeLlmClient, createProviders } from '@lectio/providers';
import type { LlmClient, LlmRequest, LlmResponse } from '@lectio/providers';
import { validateGateResult } from '@lectio/schema/gate-result';
import { validatePassage } from '@lectio/schema/passage';

import { createContext } from '../core/gate.ts';
import { renderComment } from '../core/markdown.ts';
import { runGates } from '../core/runner.ts';
import { ruleBookFor } from '../registry.ts';
import { SEED, SEED_PATH, SEED_TEXT, seedWithClaims, testContext, verdict } from './fixtures/context.ts';
import { VERIFIER_RULES, runVerifiers, summarise, verifierGate } from './index.ts';

const FILE = SEED_PATH;
const three = { [FILE]: seedWithClaims(3) };
const one = { [FILE]: seedWithClaims(1) };

interface FileMeta {
  verifierSummary: Record<string, unknown> | null;
  refutations: { confirmer: number; refuter: number };
  claims: { id: string; confirmer: Record<string, unknown>; refuter: Record<string, unknown> }[];
}

const fileMeta = (meta: Record<string, unknown>, file = FILE): FileMeta =>
  (meta['files'] as Record<string, FileMeta>)[file] as FileMeta;

const ruleIds = (items: readonly { ruleId: string }[]): string[] => items.map((item) => item.ruleId);

/** A client of a real family that answers through a fake. */
function liveClient(family: LlmClient['family'], inner: LlmClient = new FakeLlmClient()): LlmClient {
  return { family, generate: (request: LlmRequest) => inner.generate(request) };
}

describe('verifierGate', () => {
  it('declares its rules under the verifiers id and keeps the registry export', () => {
    expect(verifierGate.id).toBe('verifiers');
    expect(verifierGate.rules.length).toBeGreaterThan(0);
    for (const rule of verifierGate.rules) expect(rule.id.startsWith('verifiers/')).toBe(true);
    expect(() => ruleBookFor([verifierGate])).not.toThrow();
  });

  it('all supported: passes with a schema-shaped verifierSummary for the real seed', async () => {
    const { context, confirmer, refuter } = testContext();
    const result = await verifierGate.run(context);
    expect(validateGateResult(result)).toBe(true);
    expect(result.status).toBe('pass');
    expect(ruleIds(result.items)).toEqual(['verifiers/live-results']);
    expect(result.items[0]?.severity).toBe('info');
    expect(confirmer.calls).toHaveLength(SEED.claims.length);
    expect(refuter.calls).toHaveLength(SEED.claims.length);
    const summary = fileMeta(result.meta).verifierSummary;
    expect(summary).toEqual({
      confirmer: { model: 'claude-sonnet-5-5', minSupport: 0.95 },
      refuter: { model: 'gpt-5', minSupport: 0.95 },
      minSupport: 0.95,
      refutations: 0,
      sensitive: 0,
    });
    // It fits the review block schema as the auto path writes it.
    const review = {
      status: 'approved',
      method: 'auto',
      reviewers: [],
      approvedVia: 'auto',
      lastReviewedAt: '2026-10-05T00:00:00Z',
      verifierSummary: summary,
    };
    expect(validatePassage({ ...SEED, review })).toBe(true);
    expect(result.meta).toMatchObject({
      mode: 'fake',
      fake: true,
      minSupport: 0.9,
      calls: SEED.claims.length * 2,
      prompts: {
        confirmer: { id: 'verifier-confirmer.v1', sha256: expect.stringMatching(/^[0-9a-f]{12}$/) as string },
        refuter: { id: 'verifier-refuter.v1', sha256: expect.stringMatching(/^[0-9a-f]{12}$/) as string },
      },
    });
    expect(result.meta['costUsd']).toBeGreaterThan(0);
    expect(result.meta).not.toHaveProperty('unpricedModels');
  });

  it('sends each verifier only the claim and its sources, with the right model and prompt', async () => {
    const { context, confirmer, refuter } = testContext();
    await verifierGate.run(context);
    const request = confirmer.calls[0] as LlmRequest;
    expect(request.role).toBe('confirmer');
    expect(request.model).toBe('claude-sonnet-5-5');
    expect(request.responseSchema).toBeDefined();
    expect(request.system).toContain('confirming verifier');
    expect(refuter.calls[0]?.system).toContain('refuting verifier');
    expect(refuter.calls[0]?.model).toBe('gpt-5');
    const input = JSON.parse(request.messages[0]?.content ?? '') as Record<string, unknown>;
    expect(Object.keys(input).sort()).toEqual(['claim', 'sources']);
    const claim = SEED.claims[0];
    expect(input['claim']).toEqual({ id: claim?.id, text: claim?.text });
    expect((input['sources'] as { id: string }[]).map((source) => source.id)).toEqual(claim?.sourceIds);
    for (const call of [...confirmer.calls, ...refuter.calls]) {
      const content = call.messages[0]?.content ?? '';
      expect(content).not.toContain(SEED.summary);
      expect(content).not.toContain(SEED.provenance.runId);
      expect(content).not.toContain('"sensitive"');
      for (const paragraph of SEED.context.paragraphs) expect(content).not.toContain(paragraph);
    }
  });

  it('one refuted: fails, names both verdicts and counts the refutation', async () => {
    const { context } = testContext({
      files: three,
      refuter: [verdict(), verdict({ verdict: 'refuted', support: 0.1, rationale: 'Mark 10 has it too.' }), verdict()],
    });
    const result = await verifierGate.run(context);
    expect(result.status).toBe('fail');
    const item = result.items.find((entry) => entry.ruleId === 'verifiers/claim-not-refuted');
    expect(item).toMatchObject({ severity: 'error', file: FILE, pointer: '/claims/1', claimId: 'c2' });
    expect(item?.message).toContain('confirmer: supported 0.95');
    expect(item?.message).toContain('refuter: refuted 0.10 (“Mark 10 has it too.”)');
    const meta = fileMeta(result.meta);
    expect(meta.verifierSummary).toMatchObject({ refutations: 1, minSupport: 0.1, refuter: { minSupport: 0.1 } });
    expect(meta.refutations).toEqual({ confirmer: 0, refuter: 1 });
  });

  it('counts refuted verdicts from either verifier', async () => {
    const refuted = verdict({ verdict: 'refuted', support: 0.2 });
    const { context } = testContext({ files: three, confirmer: [refuted, verdict()], refuter: [refuted, verdict()] });
    const meta = fileMeta((await verifierGate.run(context)).meta);
    expect(meta.verifierSummary?.['refutations']).toBe(2);
    expect(meta.refutations).toEqual({ confirmer: 1, refuter: 1 });
  });

  it('one low support: flags for review with the rationale', async () => {
    const { context } = testContext({
      files: three,
      confirmer: [verdict(), verdict(), verdict({ support: 0.6, rationale: 'Only implied.' })],
    });
    const result = await verifierGate.run(context);
    expect(result.status).toBe('flag');
    const item = result.items.find((entry) => entry.ruleId === 'verifiers/claim-supported');
    expect(item).toMatchObject({ severity: 'warning', claimId: 'c3' });
    expect(item?.message).toContain('confirmer: supported 0.60 (“Only implied.”)');
    expect(fileMeta(result.meta).verifierSummary).toMatchObject({ minSupport: 0.6, confirmer: { minSupport: 0.6 } });
  });

  it('flags unsupported and uncertain verdicts even with a high score', async () => {
    const { context } = testContext({
      files: three,
      confirmer: [verdict({ verdict: 'uncertain' }), verdict({ verdict: 'unsupported' }), verdict()],
    });
    const result = await verifierGate.run(context);
    expect(ruleIds(result.items).filter((id) => id === 'verifiers/claim-supported')).toHaveLength(2);
  });

  it('one flagged sensitive: flags for review and counts the claim once', async () => {
    const sensitive = verdict({ sensitive: true });
    const { context } = testContext({
      files: three,
      confirmer: [verdict(), sensitive, verdict()],
      refuter: [verdict(), sensitive, verdict()],
    });
    const result = await verifierGate.run(context);
    expect(result.status).toBe('flag');
    const item = result.items.find((entry) => entry.ruleId === 'verifiers/claim-not-sensitive');
    expect(item).toMatchObject({ severity: 'warning', claimId: 'c2' });
    expect(item?.message).toContain('confirmer: supported 0.95; refuter: supported 0.95');
    expect(item?.message).toContain('flagged sensitive by the confirmer and refuter');
    expect(fileMeta(result.meta).verifierSummary).toMatchObject({ sensitive: 1, refutations: 0 });
  });

  it('a refuted sensitive claim reports the refutation and still mentions the flag', async () => {
    const { context } = testContext({
      files: one,
      refuter: verdict({ verdict: 'refuted', support: 0, sensitive: true }),
    });
    const result = await verifierGate.run(context);
    const item = result.items.find((entry) => entry.ruleId === 'verifiers/claim-not-refuted');
    expect(item?.message).toContain('flagged sensitive by the refuter');
  });

  it('malformed then valid: retries once and uses the valid answer', async () => {
    const { context, confirmer } = testContext({ files: one, confirmer: [{ text: '{"oops' }, verdict()] });
    const result = await verifierGate.run(context);
    expect(result.status).toBe('pass');
    expect(confirmer.calls).toHaveLength(2);
    expect(fileMeta(result.meta).claims[0]?.confirmer).toMatchObject({ verdict: 'supported', attempts: 2 });
    expect(result.meta['calls']).toBe(3);
  });

  it('malformed twice: no verdict, flagged, no verifierSummary', async () => {
    const { context, confirmer } = testContext({
      files: one,
      confirmer: [{ text: '{"oops' }, { output: { verdict: 'maybe' } }, verdict()],
    });
    const result = await verifierGate.run(context);
    expect(confirmer.calls).toHaveLength(2);
    expect(result.status).toBe('flag');
    const item = result.items.find((entry) => entry.ruleId === 'verifiers/verifier-answered');
    expect(item?.message).toMatch(/^c1 “.*”: confirmer: no verdict \(malformed: /);
    expect(item?.message).toContain('refuter: supported 0.95');
    const meta = fileMeta(result.meta);
    expect(meta.verifierSummary).toBeNull();
    expect(meta.claims[0]?.confirmer).toMatchObject({ kind: 'malformed', attempts: 2 });
  });

  it('provider error: no retry, flagged for review, the other claims still verified', async () => {
    const { context, refuter } = testContext({ files: three, refuter: [{ fail: 'unavailable' }, verdict()] });
    const result = await verifierGate.run(context);
    expect(refuter.calls).toHaveLength(3);
    expect(result.status).toBe('flag');
    const item = result.items.find((entry) => entry.ruleId === 'verifiers/verifier-answered');
    expect(item).toMatchObject({ claimId: 'c1', severity: 'warning' });
    expect(item?.message).toContain('refuter: no verdict (provider: scripted unavailable failure for refuter)');
    expect(fileMeta(result.meta).verifierSummary).toBeNull();
  });

  it('a refutation outranks a missing verdict on the same claim', async () => {
    const { context } = testContext({
      files: one,
      confirmer: { fail: 'timeout' },
      refuter: verdict({ verdict: 'refuted', support: 0 }),
    });
    const result = await verifierGate.run(context);
    expect(ruleIds(result.items)).toContain('verifiers/claim-not-refuted');
    expect(ruleIds(result.items)).not.toContain('verifiers/verifier-answered');
  });

  it('stops calling once the cost meter runs out', async () => {
    const { context, refuter } = testContext({
      files: three,
      confirmer: [verdict(), { fail: new BudgetExceededError('gates', 1, 1.5) }],
    });
    const result = await verifierGate.run(context);
    expect(refuter.calls).toHaveLength(1);
    const claims = fileMeta(result.meta).claims;
    expect(claims[1]?.confirmer).toMatchObject({ kind: 'budget', attempts: 1 });
    expect(claims[2]?.refuter).toMatchObject({ kind: 'budget', attempts: 0 });
    expect(result.status).toBe('flag');
  });

  it('skipped: no live clients in auto mode (no API keys)', async () => {
    const config = DEFAULT_CONFIG;
    const context = createContext({
      root: '/repo',
      base: 'origin/main',
      head: 'HEAD',
      config,
      providers: createProviders(config, {}),
      git: { changedFiles: () => [{ path: FILE, status: 'added' }], show: () => null },
      readText: () => SEED_TEXT,
    });
    const result = await verifierGate.run(context);
    expect(result).toMatchObject({ status: 'skipped', meta: { missing: ['confirmer', 'refuter'] } });
    expect(result.meta['reason']).toBe('no live confirmer or refuter client (API key missing); a person reviews');
  });

  it('skipped: one live client missing in auto mode', async () => {
    const { context } = testContext({ mode: 'auto' });
    const providers = createProviders(context.config, {}, { confirmer: liveClient('anthropic') });
    const result = await verifierGate.run({ ...context, providers });
    expect(result).toMatchObject({ status: 'skipped', meta: { missing: ['refuter'] } });
  });

  it('skipped: mode skip, and PRs without passage changes', async () => {
    expect((await verifierGate.run(testContext({ mode: 'skip' }).context)).status).toBe('skipped');
    const docs = testContext({ files: { 'docs/notes.md': 'x' } });
    expect(await verifierGate.run(docs.context)).toMatchObject({
      status: 'skipped',
      meta: { reason: 'no passage files changed' },
    });
    const deleted = testContext({ changed: [{ path: FILE, status: 'deleted' }] });
    expect((await verifierGate.run(deleted.context)).status).toBe('skipped');
  });

  it('runs with live clients of the configured families in auto and live mode', async () => {
    for (const mode of ['auto', 'live'] as const) {
      const { context } = testContext({
        mode,
        files: one,
        live: {
          confirmer: liveClient('anthropic', new FakeLlmClient({ roles: { confirmer: verdict() } })),
          refuter: liveClient('openai', new FakeLlmClient({ roles: { refuter: verdict() } })),
        },
      });
      const result = await verifierGate.run(context);
      expect(result.status).toBe('pass');
      expect(result.items).toEqual([]);
      expect(result.meta['fake']).toBe(false);
    }
  });

  it('live mode without live clients is an error', async () => {
    const { context } = testContext({ mode: 'live' });
    const result = await verifierGate.run({ ...context, providers: createProviders(context.config, {}) });
    expect(result.status).toBe('fail');
    expect(result.items[0]).toMatchObject({
      ruleId: 'verifiers/live-verifiers',
      message: 'no live client for the confirmer and refuter',
    });
  });

  it('enforces two different families, as configured', async () => {
    const same = {
      ...DEFAULT_CONFIG,
      verifiers: { ...DEFAULT_CONFIG.verifiers, refuter: { family: 'anthropic' as const, model: 'claude-opus-5-5' } },
    };
    const sameFamily = await verifierGate.run(testContext({ config: same }).context);
    expect(sameFamily.status).toBe('fail');
    expect(sameFamily.items.map((item) => item.message)).toContain('confirmer and refuter are both "anthropic"');

    const swapped = testContext({
      mode: 'live',
      live: { confirmer: liveClient('openai'), refuter: liveClient('openai') },
    });
    const wrong = await verifierGate.run(swapped.context);
    expect(wrong.status).toBe('fail');
    expect(wrong.items.map((item) => item.message)).toEqual([
      'the confirmer client is "openai" but config.verifiers.confirmer.family is "anthropic"',
    ]);

    // A fake client stands in for a verifier only in fake mode.
    const fakeResult = await verifierGate.run(testContext({ mode: 'live' }).context);
    expect(ruleIds(fakeResult.items)).toEqual(['verifiers/two-families', 'verifiers/two-families']);
  });

  it('reports unreadable passages as info and verifies the rest', async () => {
    const { context } = testContext({
      files: { ...one, 'passages/JN.1.1-5.json': '{"oops' },
      changed: [
        { path: 'passages/JN.1.1-5.json', status: 'added' },
        { path: 'passages/IS.55.6-9.json', status: 'modified' },
        { path: FILE, status: 'modified' },
      ],
    });
    const result = await verifierGate.run(context);
    expect(result.status).toBe('pass');
    const unreadable = result.items.filter((item) => item.ruleId === 'verifiers/passage-readable');
    expect(unreadable.map((item) => [item.file, item.severity])).toEqual([
      ['passages/JN.1.1-5.json', 'info'],
      ['passages/IS.55.6-9.json', 'info'],
    ]);
    expect(unreadable[0]?.message).toContain('not valid JSON');
    expect(unreadable[1]?.message).toBe('not verified: the file does not exist at the PR head');
    expect(Object.keys(result.meta['files'] as object)).toEqual([FILE]);
  });

  it('records unpriced models instead of failing', async () => {
    const { context } = testContext({ files: one, confirmer: { ...verdict(), model: 'mystery-model' } });
    const result = await verifierGate.run(context);
    expect(result.meta['unpricedModels']).toEqual(['mystery-model']);
    expect(fileMeta(result.meta).verifierSummary?.['confirmer']).toEqual({ model: 'mystery-model', minSupport: 0.95 });
  });

  it('uses injected prompt files', async () => {
    const { context, confirmer } = testContext({ files: one });
    const result = await runVerifiers(context, { readPrompt: (file) => `custom ${file}` });
    expect(confirmer.calls[0]?.system).toBe('custom verifier-confirmer.v1.md');
    expect(result.meta['prompts']).toMatchObject({ refuter: { id: 'verifier-refuter.v1' } });
  });

  it('the PR comment lists flagged claims with both verdicts and the sensitive flag', async () => {
    const { context } = testContext({
      files: three,
      confirmer: [verdict(), verdict({ sensitive: true }), verdict()],
      refuter: [verdict({ verdict: 'refuted', support: 0.05, rationale: 'Luke has a parallel.' }), verdict()],
    });
    const report = await runGates([verifierGate], context);
    const comment = renderComment(report, { gates: [verifierGate], rules: ruleBookFor([verifierGate]) });
    expect(comment).toContain('verifiers/claim-not-refuted');
    expect(comment).toContain('confirmer: supported 0.95; refuter: refuted 0.05 (“Luke has a parallel.”)');
    expect(comment).toContain('verifiers/claim-not-sensitive');
    expect(comment).toContain('flagged sensitive by the confirmer');
    expect(comment).toContain(VERIFIER_RULES.claimNotRefuted.statement);
  });
});

describe('summarise', () => {
  it('returns null without claims', () => {
    expect(summarise([])).toBeNull();
  });
});

describe('answers from clients that skip the fake’s own checks', () => {
  it('validates the output itself and retries once', async () => {
    let n = 0;
    const odd: LlmClient = {
      family: 'anthropic',
      generate: (request: LlmRequest): Promise<LlmResponse> => {
        n += 1;
        const output =
          n === 1
            ? { verdict: 'supported', support: 2 }
            : { verdict: 'supported', support: 1, sensitive: false, rationale: 'x'.repeat(301) };
        return Promise.resolve({
          output,
          citations: [],
          usage: { inputTokens: 1, outputTokens: 1 },
          model: request.model,
          family: 'anthropic',
        });
      },
    };
    const { context } = testContext({
      mode: 'live',
      files: one,
      live: { confirmer: odd, refuter: liveClient('openai', new FakeLlmClient({ roles: { refuter: verdict() } })) },
    });
    const result = await verifierGate.run(context);
    expect(n).toBe(2);
    const confirmer = fileMeta(result.meta).claims[0]?.confirmer;
    expect(confirmer).toMatchObject({ kind: 'malformed' });
    expect(String(confirmer?.['error'])).toContain('does not match the verdict schema');
  });

  it('reports a thrown non-Error value', async () => {
    const throwing: LlmClient = {
      family: 'openai',
      generate: () => Promise.reject('plain failure'),
    };
    const { context } = testContext({
      mode: 'live',
      files: one,
      live: {
        confirmer: liveClient('anthropic', new FakeLlmClient({ roles: { confirmer: verdict() } })),
        refuter: throwing,
      },
    });
    const result = await verifierGate.run(context);
    expect(fileMeta(result.meta).claims[0]?.refuter).toMatchObject({ kind: 'provider', error: 'plain failure' });
  });
});
