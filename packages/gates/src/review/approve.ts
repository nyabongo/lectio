/**
 * The review helper: writes the review block of passage files when a PR is approved.
 *
 * - `approveHuman` records a person's approval (`method: human`, `approvedVia: cli | label |
 *   comment`). The reviewer must be listed in `config.reviewer.githubHandles`; they may be the PR
 *   author ([decision 003](../../../../docs/decisions/003-auto-merge.md)).
 * - `approveAuto` records an auto-merge approval (`method: auto`, `approvedVia: auto`) with the
 *   verifiers' summary.
 *
 * Both are idempotent: a file that already carries the approval is left byte-for-byte unchanged
 * (its `lastReviewedAt` is not bumped). Every file is validated against the passage schema
 * before anything is written, and nothing is written unless every file succeeds. Files are
 * written with the repository's Prettier config, so `format:check` stays green.
 *
 * `npm run review:approve -- <files…> --reviewer <handle>` calls `approveHuman` locally; the CI
 * merge-rule job (L-031) calls both functions directly.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { checkPassage, contentKindOf, parseJson } from '@lectio/content';
import type { Passage, PassageReview } from '@lectio/schema/passage';
import { format, resolveConfig } from 'prettier';

export type VerifierSummary = NonNullable<PassageReview['verifierSummary']>;
export type HumanApprovalChannel = 'cli' | 'label' | 'comment';

/** Why an approval was refused; nothing has been written when it is thrown. */
export class ReviewError extends Error {
  override readonly name = 'ReviewError';
}

/** File access for the helper; tests inject their own. */
export interface ReviewFs {
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
}

export const nodeReviewFs: ReviewFs = {
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => writeFileSync(path, text, 'utf8'),
};

/** Serialises a passage for `path`; the default formats with the repository's Prettier config. */
export type FormatJson = (value: unknown, path: string) => Promise<string>;

export const prettierJson: FormatJson = async (value, path) => {
  const config = await resolveConfig(path);
  return format(JSON.stringify(value, null, 2), { ...config, parser: 'json', filepath: path });
};

export interface WriteOptions {
  readonly fs?: ReviewFs;
  readonly format?: FormatJson;
}

export interface ApproveHumanOptions extends WriteOptions {
  /** GitHub handle of the person approving (a leading `@` is ignored). */
  readonly reviewer: string;
  readonly via: HumanApprovalChannel;
  readonly now: Date | string;
  /** Supplies `reviewer.githubHandles`. */
  readonly config: Pick<LectioConfig, 'reviewer'>;
}

export interface ApprovalOutcome {
  readonly file: string;
  /** `false` when the file already carried this approval and was left untouched. */
  readonly changed: boolean;
}

/** An RFC 3339 UTC timestamp to the second. */
export function reviewTimestamp(now: Date | string): string {
  const date = typeof now === 'string' ? new Date(now) : now;
  if (Number.isNaN(date.getTime())) throw new ReviewError(`invalid review time: ${String(now)}`);
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The configured spelling of `reviewer` (case-insensitive, `@` ignored); throws for an unknown handle. */
export function configuredHandle(reviewer: string, config: Pick<LectioConfig, 'reviewer'>): string {
  const wanted = reviewer.trim().replace(/^@/, '').toLowerCase();
  const handle = config.reviewer.githubHandles.find((entry) => entry.toLowerCase() === wanted);
  if (wanted === '' || handle === undefined) {
    const known = config.reviewer.githubHandles.join(', ');
    throw new ReviewError(
      `"${reviewer}" is not a configured reviewer (config.reviewer.githubHandles: ${known === '' ? 'none' : known})`,
    );
  }
  return handle;
}

/** The review block after a human approval by `handle`, or `null` when `review` already records it. */
export function humanReview(
  review: PassageReview,
  handle: string,
  via: HumanApprovalChannel,
  lastReviewedAt: string,
): PassageReview | null {
  const humanApproved = review.status === 'approved' && review.method === 'human';
  if (humanApproved && review.reviewers.includes(handle)) return null;
  const reviewers = humanApproved ? [...review.reviewers, handle] : [handle];
  return { status: 'approved', method: 'human', reviewers, approvedVia: via, lastReviewedAt };
}

/** Checks the relation the schema documents: `minSupport` is the lower of the two verifiers' scores. */
export function checkVerifierSummary(summary: VerifierSummary): void {
  const expected = Math.min(summary.confirmer.minSupport, summary.refuter.minSupport);
  if (summary.minSupport !== expected) {
    throw new ReviewError(
      `verifierSummary.minSupport must be min(confirmer, refuter) = ${String(expected)}, got ${String(summary.minSupport)}`,
    );
  }
}

/** Key-order-independent equality for JSON values. */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (value: unknown): unknown =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .map(([key, inner]) => [key, canon(inner)]),
        )
      : Array.isArray(value)
        ? value.map(canon)
        : value;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

/** The review block after an auto approval, or `null` when `review` already records it. */
export function autoReview(
  review: PassageReview,
  verifierSummary: VerifierSummary,
  lastReviewedAt: string,
): PassageReview | null {
  const target: PassageReview = {
    status: 'approved',
    method: 'auto',
    reviewers: [],
    approvedVia: 'auto',
    lastReviewedAt,
    verifierSummary,
  };
  return sameJson({ ...review, lastReviewedAt }, target) ? null : target;
}

function readPassage(fs: ReviewFs, file: string): Passage {
  if (contentKindOf(file) !== 'passage') throw new ReviewError(`${file}: not a passage file (passages/<key>.json)`);
  let text: string;
  try {
    text = fs.readFile(file);
  } catch (error) {
    throw new ReviewError(`${file}: cannot read file (${(error as Error).message})`);
  }
  return checked(() => checkPassage(parseJson(text, file), file, basename(file, '.json')));
}

function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new ReviewError((error as Error).message);
  }
}

/** Applies `update` to every file's review block, validates all of them, then writes the changed ones. */
async function applyReview(
  files: readonly string[],
  update: (review: PassageReview) => PassageReview | null,
  options: WriteOptions,
): Promise<ApprovalOutcome[]> {
  const fs = options.fs ?? nodeReviewFs;
  const formatJson = options.format ?? prettierJson;
  if (files.length === 0) throw new ReviewError('no files to approve');
  const planned = files.map((file) => {
    const passage = readPassage(fs, file);
    const review = update(passage.review);
    const next = review === null ? null : checked(() => checkPassage({ ...passage, review }, file));
    return { file, next };
  });
  const outcomes: ApprovalOutcome[] = [];
  const writes: { file: string; text: string }[] = [];
  for (const entry of planned) {
    if (entry.next !== null) writes.push({ file: entry.file, text: await formatJson(entry.next, entry.file) });
    outcomes.push({ file: entry.file, changed: entry.next !== null });
  }
  for (const { file, text } of writes) fs.writeFile(file, text);
  return outcomes;
}

/**
 * Records a human approval on each passage file: `status: approved`, `method: human`, the
 * reviewer added to `reviewers`, `approvedVia` and `lastReviewedAt`. Throws `ReviewError` (and
 * writes nothing) for an unknown handle, a non-passage file or an invalid result.
 */
export async function approveHuman(files: readonly string[], options: ApproveHumanOptions): Promise<ApprovalOutcome[]> {
  const handle = configuredHandle(options.reviewer, options.config);
  const at = reviewTimestamp(options.now);
  return applyReview(files, (review) => humanReview(review, handle, options.via, at), options);
}

/**
 * Records an auto-merge approval on each passage file: `status: approved`, `method: auto`,
 * `approvedVia: auto`, no reviewers, `lastReviewedAt` and the verifier summary.
 */
export async function approveAuto(
  files: readonly string[],
  verifierSummary: VerifierSummary,
  now: Date | string,
  options: WriteOptions = {},
): Promise<ApprovalOutcome[]> {
  checkVerifierSummary(verifierSummary);
  const at = reviewTimestamp(now);
  return applyReview(files, (review) => autoReview(review, verifierSummary, at), options);
}
