/**
 * `PullRequestFacts.reviewEdits` from a gate context: the passage and translation
 * (`passages/i18n/<locale>/<key>.json`, L-112) files under `config.content.root` whose review block
 * the PR sets to `approved` (a new file that arrives approved counts, as does any change to an approved
 * block). The research CLI writes pending blocks, so only an approval path should ever do this.
 * The same layout elsewhere in the repository (a test fixture's `passages/` directory) is not
 * content: the site never reads it, so its review block approves nothing.
 */
import { isDeepStrictEqual } from 'node:util';

import type { LectioConfig } from '@lectio/config';
import { contentPlaceAt } from '@lectio/content';

import type { GateContext } from '../core/gate.ts';

type ReviewContext = Pick<GateContext, 'changedFiles' | 'readFile' | 'readBase'> & {
  readonly config: Pick<LectioConfig, 'content'>;
};

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

/** Whether `path` is a passage or translation file under the content root `root`. */
export function isReviewedContent(path: string, root: string): boolean {
  const kind = contentPlaceAt(path, root)?.kind;
  return kind === 'passage' || kind === 'translation';
}

/** Changed passage and translation files whose review block ends up approved and differs from the base. */
export function approvedReviewEdits(context: ReviewContext): string[] {
  const { root } = context.config.content;
  const edits: string[] = [];
  for (const file of context.changedFiles) {
    if (file.status === 'deleted' || !isReviewedContent(file.path, root)) continue;
    const head = reviewOf(context.readFile(file.path));
    if (!isApproved(head)) continue;
    const base = reviewOf(context.readBase(file.previousPath ?? file.path));
    if (!isDeepStrictEqual(base, head)) edits.push(file.path);
  }
  return edits;
}
