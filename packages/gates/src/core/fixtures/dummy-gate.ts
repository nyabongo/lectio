/**
 * A dummy gate for the framework tests: it reads the changed passage files through the context
 * and reports one finding of each kind (claim-level error, file-level warning, info note and a
 * whole-PR finding), so the runner, JSON report and PR comment are exercised end to end.
 */
import type { Gate, GateContext } from '../gate.ts';
import { finding, resultFromFindings } from '../result.ts';
import type { GateResultItem } from '../result.ts';
import { defineRule } from '../rules.ts';

export const DUMMY_RULES = {
  claimCited: defineRule(
    'dummy/claim-cites-source',
    'Every claim cites at least one source.',
    'Add the id of a supporting source to the claim’s sourceIds.',
  ),
  summaryShort: defineRule(
    'dummy/summary-short',
    'A passage summary stays under 100 characters.',
    'Shorten the summary to one plain sentence.',
  ),
  fileCount: defineRule(
    'dummy/file-count',
    'A content PR changes at most one passage.',
    'Split the PR so each passage is reviewed on its own.',
  ),
} as const;

interface PassageLike {
  readonly summary?: string;
  readonly claims?: readonly { readonly id: string; readonly sourceIds: readonly string[] }[];
}

function check(context: GateContext): GateResultItem[] {
  const items: GateResultItem[] = [];
  const passages = context.changedFiles.filter(
    (file) => file.path.startsWith('passages/') && file.status !== 'deleted',
  );
  for (const { path } of passages) {
    const passage = JSON.parse(context.readFile(path) ?? '{}') as PassageLike;
    (passage.claims ?? []).forEach((claim, index) => {
      if (claim.sourceIds.length === 0) {
        items.push(
          finding(DUMMY_RULES.claimCited, {
            file: path,
            pointer: `/claims/${String(index)}/sourceIds`,
            claimId: claim.id,
            message: `claim ${claim.id} cites no source`,
          }),
        );
      }
    });
    if ((passage.summary ?? '').length >= 100) {
      items.push(
        finding(DUMMY_RULES.summaryShort, {
          file: path,
          pointer: '/summary',
          severity: 'warning',
          message: `summary is ${String(passage.summary?.length)} characters`,
        }),
      );
    }
  }
  if (passages.length > 1) {
    items.push(
      finding(DUMMY_RULES.fileCount, { severity: 'info', message: `${String(passages.length)} passages changed` }),
    );
  }
  return items;
}

export const dummyGate: Gate = {
  id: 'dummy',
  title: 'Dummy gate',
  rules: Object.values(DUMMY_RULES),
  run: (context) => resultFromFindings('dummy', check(context), { files: context.changedFiles.length }),
};

/** A gate that always passes. */
export const passingGate: Gate = {
  id: 'always-pass',
  title: 'Always passes',
  rules: [],
  run: () => resultFromFindings('always-pass', []),
};

/** Fake repository files for the dummy gate, as path → JSON text. */
export const DUMMY_FILES: Readonly<Record<string, string>> = {
  'passages/MT.20.1-16.json': JSON.stringify({
    summary:
      'A landowner pays the last hired the same as the first, and asks whether his goodness is a cause for resentment.',
    claims: [
      { id: 'c1', sourceIds: ['davies-allison'] },
      { id: 'c2', sourceIds: [] },
      { id: 'c10', sourceIds: [] },
    ],
  }),
  'passages/IS.55.6-9.json': JSON.stringify({ summary: 'A call to return to a merciful God.', claims: [] }),
};

/** `git diff --name-status -z` output for the dummy PR. */
export const DUMMY_DIFF = [
  'M',
  'passages/MT.20.1-16.json',
  'A',
  'passages/IS.55.6-9.json',
  'D',
  'passages/OLD.json',
  'M',
  'docs/notes.md',
  '',
].join('\0');
