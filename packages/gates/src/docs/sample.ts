/**
 * The sample PR comment in docs/gates.md: an invented content PR run through the real merge rule
 * (`decide`) and the real comment renderer (`renderDecisionComment`), so the docs show exactly what
 * the merge-rule job posts. The passage, sources and messages are made up; no reading text appears.
 */
import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';

import { renderDecisionComment } from '../ci/merge-rule-job.ts';
import type { PullRequestFacts } from '../core/pull-request.ts';
import { finding, resultFromFindings } from '../core/result.ts';
import type { GateResult } from '../core/result.ts';
import { EVIDENCE_RULES } from '../evidence-gate/index.ts';
import { LICENCE_RULES, LIMITATION } from '../licence-gate/index.ts';
import { decide } from '../merge-rule/index.ts';
import type { DecideOutput, VerifierClaimRecord } from '../merge-rule/index.ts';
import { VERIFIER_RULES } from '../verifier-gate/index.ts';

/** The invented passage file the sample PR changes. */
export const SAMPLE_FILE = 'passages/MT.20.1-16.json';
/** A placeholder head sha (the real comment names the full commit sha it checked). */
export const SAMPLE_HEAD = '0123456789abcdef0123456789abcdef01234567';
export const SAMPLE_BASE = 'origin/main';

const supported = (support: number) => ({ verdict: 'supported', support, sensitive: false }) as const;

/** The per-claim verifier records (the `meta.claims` contract the merge rule reads). */
const CLAIMS: readonly VerifierClaimRecord[] = [
  { file: SAMPLE_FILE, claimId: 'c1', sensitive: false, confirmer: supported(0.96), refuter: supported(0.93) },
  { file: SAMPLE_FILE, claimId: 'c2', sensitive: false, confirmer: supported(0.94), refuter: supported(0.78) },
  { file: SAMPLE_FILE, claimId: 'c3', sensitive: false, confirmer: supported(0.95), refuter: supported(0.91) },
];

/** What the trusted run hands the merge rule: schema passes, one print source, one weakly supported claim. */
export function sampleResults(): GateResult[] {
  return [
    resultFromFindings('schema', [], { files: 1 }),
    resultFromFindings('evidence', [
      finding(EVIDENCE_RULES.printSourceFlag, {
        file: SAMPLE_FILE,
        pointer: '/sources/2',
        claimId: 'c3',
        severity: 'warning',
        message: 'source "s3" is a print source (a printed commentary, p. 112) and cannot be checked automatically',
      }),
    ]),
    resultFromFindings('licence', [
      finding(LICENCE_RULES.pdBibleOverlap, { severity: 'info', message: `Limitation: ${LIMITATION}` }),
    ]),
    resultFromFindings(
      'verifiers',
      [
        finding(VERIFIER_RULES.claimSupported, {
          file: SAMPLE_FILE,
          pointer: '/claims/1',
          claimId: 'c2',
          severity: 'warning',
          message:
            'c2 “The denarius was a usual day’s wage for a labourer.”: confirmer: supported 0.94; ' +
            'refuter: supported 0.78 (“the cited page gives the wage for soldiers, not labourers”)',
        }),
      ],
      { claims: CLAIMS },
    ),
  ];
}

/** The sample PR: one passage changed, no approval yet. */
export function samplePullRequest(): PullRequestFacts {
  return {
    number: 301,
    files: [SAMPLE_FILE],
    reviewEdits: [],
    approval: null,
    approvalCommit: null,
    lastContentCommitAt: '2026-10-05T10:00:00Z',
    fork: false,
  };
}

/** The merge rule's decision on the sample (needs-review, with its reasons). */
export function sampleDecision(config: LectioConfig = DEFAULT_CONFIG): DecideOutput {
  const claims = CLAIMS.map(({ file, claimId }) => ({ file, claimId }));
  return decide({ results: sampleResults(), config, pr: samplePullRequest(), claims });
}

/** The sticky comment the merge-rule job would post on the sample PR. */
export function sampleComment(config: LectioConfig = DEFAULT_CONFIG): string {
  const place = { results: sampleResults(), head: SAMPLE_HEAD, base: SAMPLE_BASE, changedFiles: [SAMPLE_FILE] };
  return renderDecisionComment(place, sampleDecision(config), []);
}
