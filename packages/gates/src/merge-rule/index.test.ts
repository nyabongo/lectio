import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { validateGateResult } from '@lectio/schema/gate-result';

import { createContext } from '../core/gate.ts';
import type { GateContext } from '../core/gate.ts';
import type { ChangedFile } from '../core/git.ts';
import type { GateResult } from '../core/result.ts';
import { ruleBookFor } from '../registry.ts';
import {
  APPROVED_AT,
  CONTENT_COMMIT_AT,
  DETERMINISTIC_PASS,
  LATER_CONTENT_COMMIT_AT,
  PASSAGE,
  approvalCommit,
  claim,
  failResult,
  flagResult,
  greenResults,
  passResult,
  prFacts,
  skippedResult,
  verdict,
  verifierResult,
} from './fixtures/facts.ts';
import {
  DECISIONS,
  GREEN_DECISIONS,
  MERGE_RULES,
  UNREADABLE_CLAIMS,
  assess,
  decide,
  factsFromChanges,
  mergeRuleGate,
} from './index.ts';
import type { PullRequestFacts } from '../core/pull-request.ts';
import type { ClaimRef } from './claims.ts';

function config(autoMerge: Partial<LectioConfig['autoMerge']> = {}, contentRoot = '.'): LectioConfig {
  return {
    ...DEFAULT_CONFIG,
    content: { ...DEFAULT_CONFIG.content, root: contentRoot },
    autoMerge: { ...DEFAULT_CONFIG.autoMerge, ...autoMerge },
  };
}

function run(
  results: readonly GateResult[] = greenResults(),
  pr: Partial<PullRequestFacts> = {},
  cfg: LectioConfig = config(),
  claims: readonly ClaimRef[] = [],
) {
  return decide({ results, config: cfg, pr: prFacts(pr), claims });
}

const human = { handle: 'nyabongo', via: 'label', at: APPROVED_AT } as const;

describe('decisions', () => {
  it('only approval decisions are green', () => {
    expect(DECISIONS.filter((decision) => GREEN_DECISIONS.has(decision))).toEqual([
      'approved-commit',
      'human-approved',
      'auto-merge',
    ]);
  });

  it('auto-merges when everything is green, and ignores the merge rule’s own result', () => {
    const merge: GateResult = { ...failResult('merge-rule') };
    expect(run([...greenResults(), merge])).toEqual({
      decision: 'auto-merge',
      reasons: ['every gate passed and both verifiers support all 2 claims at 0.9 or higher, with no refutation'],
    });
  });
});

describe('blocked', () => {
  it('blocks when a deterministic gate failed, whatever else holds', () => {
    const results = [failResult('schema'), passResult('evidence'), failResult('licence')];
    expect(run(results, { approval: human, approvalCommit: approvalCommit() })).toEqual({
      decision: 'blocked',
      reasons: ['the schema gate failed', 'the licence gate failed'],
    });
  });

  it('blocks on a crashed gate that is not the verifiers', () => {
    expect(run([...greenResults(), failResult('runner')]).decision).toBe('blocked');
  });

  it('lists both a failed gate and a forged approval commit', () => {
    const results = [failResult('schema')];
    expect(run(results, { approvalCommit: approvalCommit({ authorIsBot: false }) }).reasons).toEqual([
      'the schema gate failed',
      'forged approval commit (human, run 9876543210): it is not authored by github-actions[bot]',
    ]);
  });

  it('blocks a review block set to approved without a counted approval, noting an ignored approval', () => {
    const stranger = { handle: 'someone', via: 'comment', at: APPROVED_AT } as const;
    expect(run(greenResults(), { reviewEdits: [PASSAGE], approval: stranger })).toEqual({
      decision: 'blocked',
      reasons: [
        `${PASSAGE} sets its review block to approved without a verified approval or a valid approval commit`,
        'approval by @someone via comment ignored: not a handle in config.reviewer.githubHandles',
      ],
    });
    expect(run(greenResults(), { reviewEdits: [PASSAGE] }).decision).toBe('blocked');
  });
});

describe('approved-commit', () => {
  it('needs no verifier results', () => {
    expect(
      run(DETERMINISTIC_PASS, { approvalCommit: approvalCommit({ kind: 'auto' }), reviewEdits: [PASSAGE] }),
    ).toEqual({
      decision: 'approved-commit',
      reasons: [`the head is a valid auto approval commit from run 9876543210 on ${'a'.repeat(40)}`],
    });
    expect(run([], { approvalCommit: approvalCommit() }).decision).toBe('approved-commit');
  });
});

describe('human-approved', () => {
  it('counts a configured reviewer after the last content commit, ignoring case and @', () => {
    expect(run([], { approval: { handle: '@NyaBongo', via: 'comment', at: APPROVED_AT } })).toEqual({
      decision: 'human-approved',
      reasons: [`approved by @NyaBongo via comment at ${APPROVED_AT}, after the last content commit`],
    });
  });

  it('counts an approval when there is no content commit at all', () => {
    expect(run([], { approval: human, lastContentCommitAt: null }).decision).toBe('human-approved');
  });

  it.each([
    [
      'a stale approval',
      { approval: human, lastContentCommitAt: LATER_CONTENT_COMMIT_AT },
      `approval by @nyabongo via label ignored: given at ${APPROVED_AT}, not after the last content commit at ${LATER_CONTENT_COMMIT_AT}`,
    ],
    [
      'an approval in the same second as the commit',
      { approval: { ...human, at: CONTENT_COMMIT_AT } },
      `approval by @nyabongo via label ignored: given at ${CONTENT_COMMIT_AT}, not after the last content commit at ${CONTENT_COMMIT_AT}`,
    ],
    [
      'an approval with a bad time',
      { approval: { ...human, at: 'soon' } },
      'approval by @nyabongo via label ignored: its time "soon" is not a timestamp',
    ],
    [
      'a bad last commit time',
      { approval: human, lastContentCommitAt: 'later' },
      'approval by @nyabongo via label ignored: the last content commit time "later" is not a timestamp',
    ],
  ] as const)('ignores %s (then decides as without it)', (_name, pr, note) => {
    const outcome = run(greenResults(), { ...pr, fork: true });
    expect(outcome.decision).toBe('needs-review');
    expect(outcome.reasons).toEqual(['the PR comes from a fork', note]);
  });
});

describe('needs-review', () => {
  it('collects every review condition', () => {
    const results = [
      passResult('schema'),
      skippedResult('evidence'),
      flagResult('licence'),
      verifierResult([
        claim('c1', { sensitive: true, confirmer: verdict({ support: 0.5, sensitive: true }) }),
        claim('c2', { confirmer: null, refuter: verdict({ verdict: 'refuted', support: 0.1 }) }),
        claim('c3', { confirmer: verdict({ verdict: 'uncertain' }), refuter: verdict({ verdict: 'unsupported' }) }),
        claim('c4', { confirmer: null, refuter: null }),
      ]),
    ];
    const files = [
      './config/lectio.config.json',
      '.github\\workflows\\ci.yml',
      'packages/gates/src/x.ts',
      PASSAGE,
      PASSAGE,
    ];
    expect(run(results, { files, fork: true }, config({ enabled: false }))).toEqual({
      decision: 'needs-review',
      reasons: [
        'config/lectio.config.json is under config/** (never auto-merged)',
        '.github/workflows/ci.yml is under .github/** (never auto-merged)',
        'packages/gates/src/x.ts is under packages/gates/** (never auto-merged)',
        'autoMerge.enabled is false',
        'the evidence gate did not run',
        `claim c1 (${PASSAGE}): confirmer support 0.5 is below 0.9`,
        `claim c1 (${PASSAGE}) is flagged sensitive by the generator and the confirmer`,
        `claim c2 (${PASSAGE}) has no confirmer verdict`,
        `claim c2 (${PASSAGE}): refuter support 0.1 is below 0.9`,
        `claim c3 (${PASSAGE}): confirmer verdict is uncertain`,
        `claim c3 (${PASSAGE}): refuter verdict is unsupported`,
        `claim c4 (${PASSAGE}) has no verifier verdict`,
        `claim c4 (${PASSAGE}) has no confirmer verdict`,
        `claim c4 (${PASSAGE}) has no refuter verdict`,
        '1 refuted verdict, more than autoMerge.maxRefutations (0)',
        'the licence gate flagged 1 finding',
        'config/lectio.config.json is outside passages/',
        '.github/workflows/ci.yml is outside passages/',
        'packages/gates/src/x.ts is outside passages/',
        'the PR comes from a fork',
      ],
      manualMerge: true,
    });
  });

  it('marks a .github/** PR for a manual merge whatever the decision', () => {
    const files = [PASSAGE, './.github/workflows/content-gates.yml'];
    expect(run(greenResults(), { files }).manualMerge).toBe(true);
    expect(run([], { files, approval: human })).toMatchObject({ decision: 'human-approved', manualMerge: true });
    expect(run([], { files: [PASSAGE, 'config/lectio.config.json'], approval: human })).not.toHaveProperty(
      'manualMerge',
    );
  });

  it('needs a verifier record for every claim of the changed passages', () => {
    const expected = [
      { file: PASSAGE, claimId: 'c1' },
      { file: PASSAGE, claimId: 'c2' },
    ];
    expect(run(greenResults(), {}, config(), expected).decision).toBe('auto-merge');
    const dotted = greenResults([
      claim('c1', { file: `./${PASSAGE}` }),
      claim('c2', { file: PASSAGE.replace('/', '\\') }),
    ]);
    expect(run(dotted, {}, config(), expected).decision).toBe('auto-merge');
    expect(run(greenResults([claim('c1')]), {}, config(), expected).reasons).toEqual([
      `claim c2 (${PASSAGE}) has no verifier record`,
    ]);
    const unreadable = [{ file: 'passages/X.json', claimId: UNREADABLE_CLAIMS }];
    const outcome = assess({ results: greenResults(), config: config(), pr: prFacts(), claims: unreadable });
    expect(outcome.reasons).toEqual([
      expect.objectContaining({
        file: 'passages/X.json',
        message: `claim ${UNREADABLE_CLAIMS} (passages/X.json) has no verifier record`,
      }),
    ]);
    expect(outcome.reasons[0]).not.toHaveProperty('claimId');
  });

  it('a protected path needs review even with perfect scores and every option off', () => {
    const relaxed = config({ passagesOnly: false, flagsRequireReview: false, sensitiveClaimsRequireReview: false });
    expect(run(greenResults(), { files: [PASSAGE, 'config/lectio.config.json'] }, relaxed)).toEqual({
      decision: 'needs-review',
      reasons: ['config/lectio.config.json is under config/** (never auto-merged)'],
    });
  });

  it('needs every deterministic gate to have run', () => {
    expect(run([passResult('schema'), verifierResult([claim('c1')])]).reasons).toEqual([
      'the evidence gate did not run',
      'the licence gate did not run',
    ]);
  });

  it.each([
    ['skipped', [...DETERMINISTIC_PASS, skippedResult('verifiers')], 'the verifiers were skipped'],
    ['missing', [...DETERMINISTIC_PASS], 'the verifiers were skipped'],
    ['failed', [...DETERMINISTIC_PASS, failResult('verifiers')], 'the verifiers gate failed'],
    ['unreadable', [...DETERMINISTIC_PASS, passResult('verifiers')], 'the verifiers result has no meta.claims list'],
    [
      'fakes',
      [...DETERMINISTIC_PASS, passResult('verifiers', { fake: true, claims: [claim('c1')] })],
      'the verdicts came from fake verifier clients',
    ],
    ['empty', [...DETERMINISTIC_PASS, verifierResult([])], 'the verifiers checked no claims'],
  ])('needs review when the verifiers are %s', (_name, results, reason) => {
    expect(run(results)).toEqual({ decision: 'needs-review', reasons: [reason] });
  });

  it('counts refutations against maxRefutations and reads a flagged verifiers result', () => {
    const refuted = (id: string) => claim(id, { refuter: verdict({ verdict: 'refuted' }) });
    const results = [...DETERMINISTIC_PASS, flagResult('verifiers', { claims: [refuted('c1'), refuted('c2')] })];
    const lenient = config({ maxRefutations: 1, flagsRequireReview: false });
    expect(run(results, {}, lenient).reasons).toEqual(['2 refuted verdicts, more than autoMerge.maxRefutations (1)']);
    expect(run(results, {}, config({ maxRefutations: 2, flagsRequireReview: false })).decision).toBe('auto-merge');
  });

  it('a verifier-only sensitive flag needs review unless sensitiveClaimsRequireReview is off', () => {
    const results = greenResults([claim('c1', { refuter: verdict({ sensitive: true }) })]);
    expect(run(results).reasons).toEqual([`claim c1 (${PASSAGE}) is flagged sensitive by the refuter`]);
    expect(run(results, {}, config({ sensitiveClaimsRequireReview: false })).decision).toBe('auto-merge');
  });

  it('accepts a single verifier when requireBothVerifiers is off', () => {
    const results = greenResults([claim('c1', { refuter: null })]);
    expect(run(results).reasons).toEqual([`claim c1 (${PASSAGE}) has no refuter verdict`]);
    expect(run(results, {}, config({ requireBothVerifiers: false })).decision).toBe('auto-merge');
  });

  it('flags and files outside passages/ follow their options', () => {
    const results = [...DETERMINISTIC_PASS.slice(0, 2), flagResult('licence'), verifierResult([claim('c1')])];
    expect(run(results).decision).toBe('needs-review');
    expect(run(results, {}, config({ flagsRequireReview: false })).decision).toBe('auto-merge');
    const calendar = { files: [PASSAGE, 'calendar/2026.json'] };
    expect(run(greenResults(), calendar).reasons).toEqual(['calendar/2026.json is outside passages/']);
    expect(run(greenResults(), calendar, config({ passagesOnly: false })).decision).toBe('auto-merge');
  });

  it('reports a flag with several findings in the plural', () => {
    const results = [
      ...DETERMINISTIC_PASS,
      {
        ...flagResult('verifiers', { claims: [claim('c1')] }),
        items: [...flagResult('x').items, ...flagResult('y').items],
      },
    ];
    expect(run(results).reasons).toEqual(['the verifiers gate flagged 2 findings']);
  });

  it('never auto-merges a translation, whatever autoMerge.flagsRequireReview says', () => {
    const translation = 'passages/i18n/sw/MT.20.1-16.json';
    const files = { files: [PASSAGE, translation] };
    const off = config({ flagsRequireReview: false });
    expect(run(greenResults(), files, off)).toEqual({
      decision: 'needs-review',
      reasons: [`${translation} is a translation (never auto-merged)`],
    });
    const outcome = assess({ results: greenResults(), config: off, pr: prFacts(files), claims: [] });
    expect(outcome.reasons.map((reason) => reason.rule.id)).toEqual([MERGE_RULES.translationNeedsPerson.id]);
    const nested = config({ flagsRequireReview: false }, 'content');
    expect(run(greenResults(), { files: ['content/passages/i18n/sw/MT.20.1-16.json'] }, nested).decision).toBe(
      'needs-review',
    );
    // A configured reviewer's approval still merges it.
    expect(run(greenResults(), { ...files, approval: human }, off).decision).toBe('human-approved');
  });

  it('keeps the translation hold for case variants and any other subdirectory of passages/', () => {
    const off = config({ flagsRequireReview: false });
    for (const file of [
      'passages/I18N/sw/MT.20.1-16.json',
      'passages/I18n/sw/MT.20.1-16.json',
      'Passages/i18n/sw/MT.20.1-16.json',
      'PASSAGES/I18N/SW/MT.20.1-16.JSON',
      'passages/i18n/sw/nested/MT.20.1-16.json',
      'passages/translations/sw/MT.20.1-16.json',
      './passages/I18N/sw/MT.20.1-16.json',
      'passages\\I18N\\sw\\MT.20.1-16.json',
    ]) {
      const outcome = assess({
        results: greenResults(),
        config: off,
        pr: prFacts({ files: [PASSAGE, file] }),
        claims: [],
      });
      expect(
        outcome.reasons.map((reason) => reason.rule.id),
        file,
      ).toContain(MERGE_RULES.translationNeedsPerson.id);
    }
    const nested = config({ flagsRequireReview: false }, 'content');
    expect(run(greenResults(), { files: ['content/passages/I18N/sw/MT.20.1-16.json'] }, nested).decision).toBe(
      'needs-review',
    );
    // A passage directly in passages/, in any case, is not a translation.
    for (const file of [PASSAGE, 'passages/LK.9.1-6.json']) {
      expect(run(greenResults(), { files: [file] }, off).decision, file).toBe('auto-merge');
    }
  });

  it('resolves passages/ under the configured content root', () => {
    const nested = config({}, './content/');
    expect(run(greenResults(), {}, nested).reasons).toEqual([`${PASSAGE} is outside content/passages/`]);
    expect(run(greenResults(), { files: ['content/passages/MT.20.1-16.json'] }, nested).decision).toBe('auto-merge');
  });
});

describe('assess', () => {
  it('keeps the rule behind each reason', () => {
    const outcome = assess({ results: greenResults(), config: config(), pr: prFacts({ fork: true }), claims: [] });
    expect(outcome.reasons.map((reason) => reason.rule.id)).toEqual([MERGE_RULES.sameRepository.id]);
  });
});

describe('mergeRuleGate', () => {
  const approvedReview = { status: 'approved', method: 'human', reviewers: ['nyabongo'], approvedVia: 'label' };

  function contextFor(
    changedFiles: ChangedFile[],
    head: Record<string, unknown>,
    base: Record<string, unknown> = {},
    results: GateResult[] = greenResults(),
  ): GateContext {
    const context = createContext({
      root: '/repo',
      base: 'origin/main',
      head: 'HEAD',
      config: config(),
      providers: {} as never,
      repo: {} as never,
      git: {
        changedFiles: () => changedFiles,
        show: (_ref, path) => (path in base ? JSON.stringify(base[path]) : null),
      },
      readText: (path) => {
        const key = path.slice(join('/repo', '/').length);
        return key in head ? JSON.stringify(head[key]) : null;
      },
    });
    return { ...context, results };
  }

  it('declares its rules under its own id', () => {
    expect(mergeRuleGate.id).toBe('merge-rule');
    expect(mergeRuleGate.rules.length).toBe(Object.keys(MERGE_RULES).length);
    expect(() => ruleBookFor([mergeRuleGate])).not.toThrow();
  });

  it('checks verifier coverage against the claims of the changed passages at the head', async () => {
    const head = { [PASSAGE]: { claims: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] } };
    const result = await mergeRuleGate.run(contextFor([{ path: PASSAGE, status: 'modified' }], head));
    expect(result.items.map((item) => [item.ruleId, item.claimId])).toEqual([
      ['merge-rule/every-claim-verified', 'c3'],
    ]);
  });

  it('reports a green decision as a passing result with an info item', async () => {
    const result = await mergeRuleGate.run(contextFor([{ path: PASSAGE, status: 'added' }], {}));
    expect(validateGateResult(result)).toBe(true);
    expect(result).toEqual({
      gate: 'merge-rule',
      status: 'pass',
      items: [
        {
          ruleId: 'merge-rule/auto-merge',
          severity: 'info',
          pointer: '',
          message: 'every gate passed and both verifiers support all 2 claims at 0.9 or higher, with no refutation',
        },
      ],
      meta: { decision: 'auto-merge', manualMerge: false },
    });
  });

  it('flags needs-review with file and claim pointers, counting a rename’s old path', async () => {
    const results = greenResults([claim('c5', { sensitive: true })]);
    const files: ChangedFile[] = [{ path: PASSAGE, status: 'renamed', previousPath: 'config/old.json' }];
    const result = await mergeRuleGate.run(contextFor(files, {}, {}, results));
    expect(validateGateResult(result)).toBe(true);
    expect(result.status).toBe('flag');
    expect(result.items).toEqual([
      {
        ruleId: 'merge-rule/protected-path',
        severity: 'warning',
        file: 'config/old.json',
        pointer: '',
        message: 'config/old.json is under config/** (never auto-merged)',
      },
      {
        ruleId: 'merge-rule/sensitive-claim',
        severity: 'warning',
        file: PASSAGE,
        pointer: '',
        claimId: 'c5',
        message: `claim c5 (${PASSAGE}) is flagged sensitive by the generator`,
      },
      {
        ruleId: 'merge-rule/passages-only',
        severity: 'warning',
        file: 'config/old.json',
        pointer: '',
        message: 'config/old.json is outside passages/',
      },
    ]);
  });

  it('fails a hand-edited approved review block', async () => {
    const result = await mergeRuleGate.run(
      contextFor(
        [{ path: PASSAGE, status: 'modified' }],
        { [PASSAGE]: { review: approvedReview } },
        {
          [PASSAGE]: { review: { status: 'pending', reviewers: [] } },
        },
      ),
    );
    expect(validateGateResult(result)).toBe(true);
    expect(result.status).toBe('fail');
    expect(result.items.map((item) => item.ruleId)).toEqual(['merge-rule/review-block-approved']);
  });

  it('blocks a self-approved translation riding along with a verified English passage', () => {
    const translation = 'passages/i18n/sw/MT.20.1-16.json';
    const view = contextFor(
      [
        { path: PASSAGE, status: 'modified' },
        { path: translation, status: 'added' },
      ],
      { [PASSAGE]: { review: { status: 'pending', reviewers: [] } }, [translation]: { review: approvedReview } },
      { [PASSAGE]: { review: { status: 'pending', reviewers: [] } } },
    );
    const facts = factsFromChanges(view, 42);
    expect(facts.reviewEdits).toEqual([translation]);
    // Even with every review condition except the translation hold switched off.
    const lax = config({ flagsRequireReview: false, passagesOnly: false, sensitiveClaimsRequireReview: false });
    const outcome = decide({
      results: greenResults(),
      config: lax,
      pr: { ...facts, lastContentCommitAt: CONTENT_COMMIT_AT },
      claims: [],
    });
    expect(outcome.decision).toBe('blocked');
    expect(outcome.reasons[0]).toBe(
      `${translation} sets its review block to approved without a verified approval or a valid approval commit`,
    );
  });

  it('does not block approved-looking fixtures outside the content root', async () => {
    const fixture = 'tests/gates/fixtures/bad-week/head/passages/MT.20.1-16.json';
    const view = contextFor([{ path: fixture, status: 'added' }], { [fixture]: { review: approvedReview } });
    expect(factsFromChanges(view).reviewEdits).toEqual([]);
    const result = await mergeRuleGate.run(view);
    expect(result.items.map((item) => item.ruleId)).not.toContain('merge-rule/review-block-approved');
    expect(result.status).not.toBe('fail');
  });

  it('builds the facts it can see from the context', () => {
    const files: ChangedFile[] = [
      { path: PASSAGE, status: 'modified' },
      { path: 'passages/JN.1.1-5.json', status: 'renamed', previousPath: PASSAGE },
    ];
    expect(factsFromChanges(contextFor(files, {}))).toEqual({
      files: [PASSAGE, 'passages/JN.1.1-5.json'],
      reviewEdits: [],
      approval: null,
      approvalCommit: null,
      lastContentCommitAt: null,
      fork: false,
      number: 0,
    });
  });
});
