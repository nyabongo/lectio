/**
 * `PullRequestFacts.reviewEdits` from a gate context: the passage files whose review block the PR
 * sets to `approved` (a new file that arrives approved counts, as does any change to an approved
 * block). The research CLI writes pending blocks, so only an approval path should ever do this.
 */
import { isDeepStrictEqual } from 'node:util';

import { contentKindOf } from '@lectio/content';

import type { GateContext } from '../core/gate.ts';

type ReviewContext = Pick<GateContext, 'changedFiles' | 'readFile' | 'readBase'>;

function reviewOf(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === 'object' && value !== null ? (value as { review?: unknown }).review : undefined;
  } catch {
    return undefined;
  }
}

const isApproved = (review: unknown): boolean =>
  typeof review === 'object' && review !== null && (review as { status?: unknown }).status === 'approved';

/** Changed passage files whose review block ends up approved and differs from the base. */
export function approvedReviewEdits(context: ReviewContext): string[] {
  const edits: string[] = [];
  for (const file of context.changedFiles) {
    if (file.status === 'deleted' || contentKindOf(file.path) !== 'passage') continue;
    const head = reviewOf(context.readFile(file.path));
    if (!isApproved(head)) continue;
    const base = reviewOf(context.readBase(file.previousPath ?? file.path));
    if (!isDeepStrictEqual(base, head)) edits.push(file.path);
  }
  return edits;
}
