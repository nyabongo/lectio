/**
 * The review helper: writes the review block of passage files, and of translation files
 * (`passages/i18n/<locale>/<key>.json`, L-112), when a PR is approved.
 *
 * - `approveHuman` records a person's approval (`method: human`, `approvedVia: cli | label |
 *   comment`). The reviewer must be listed in `config.reviewer.githubHandles`; they may be the PR
 *   author ([decision 003](../../../../docs/decisions/003-auto-merge.md)).
 * - `approveAuto` records an auto-merge approval (`method: auto`, `approvedVia: auto`) with the
 *   verifiers' summary.
 *
 * Both are keyed on the approval event. A repeat of the same event (same reviewer, channel and
 * time for a human approval; same verifier summary and time for an auto approval) leaves the
 * file byte-for-byte unchanged. A new event (a later approval, another channel, a new summary)
 * rewrites the block, so `lastReviewedAt` always records the latest approval. Decision 003 only
 * counts an approval made after the last content commit, so approving edited content is always a
 * new event, and the CI job (L-031) always has a review block to commit after a fixup. Each
 * outcome carries the SHA-256 of the passage without its review block (`contentHash`) for the
 * approval commit; the passage schema has no field to store it in the file itself.
 *
 * Every file is validated against the passage schema before anything is written, and the writes
 * are atomic as a set: each file is written to a temporary file next to it, then renamed into
 * place; if any step fails, the files already replaced are restored and the temporary files
 * removed. Files are written with the repository's Prettier config, so `format:check` stays green.
 *
 * Translations are approved by a person only: `approveHuman` writes their review block under the
 * same rules, and `approveAuto` refuses them (the translated-passage schema has no auto path).
 *
 * `npm run review:approve -- <files…> --reviewer <handle>` calls `approveHuman` locally; the CI
 * merge-rule job (L-031) calls both functions directly.
 */
import { createHash } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { checkPassage, checkTranslatedPassage, contentKindOf, parseJson, translationPlaceOf } from '@lectio/content';
import type { Passage, PassageReview } from '@lectio/schema/passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';
import { format, resolveConfig } from 'prettier';

export type VerifierSummary = NonNullable<PassageReview['verifierSummary']>;
export type HumanApprovalChannel = 'cli' | 'label' | 'comment';

/** Why an approval was refused. Nothing has been written when this (or any other error) is thrown. */
export class ReviewError extends Error {
  override readonly name = 'ReviewError';
}

/** File access for the helper; tests inject their own. */
export interface ReviewFs {
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  /** Replaces `to` with `from` (atomic within one file system). */
  rename(from: string, to: string): void;
  /** Deletes `path`; no error when it does not exist. */
  remove(path: string): void;
}

export const nodeReviewFs: ReviewFs = {
  readFile: (path) => readFileSync(path, 'utf8'),
  writeFile: (path, text) => {
    writeFileSync(path, text, 'utf8');
  },
  rename: (from, to) => {
    renameSync(from, to);
  },
  remove: (path) => {
    rmSync(path, { force: true });
  },
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
  /** When the approval happened: the label or comment event time in CI, the clock locally. */
  readonly now: Date | string;
  /** Supplies `reviewer.githubHandles`. */
  readonly config: Pick<LectioConfig, 'reviewer'>;
}

export interface ApprovalOutcome {
  readonly file: string;
  /** `false` when the file already recorded this approval event and was left untouched. */
  readonly changed: boolean;
  /** SHA-256 (hex) of the passage without its review block: the content that was approved. */
  readonly contentHash: string;
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

/**
 * The review block after a human approval by `handle` via `via` at `lastReviewedAt`, or `null`
 * when `review` already records exactly that approval. Earlier human reviewers are kept.
 */
export function humanReview(
  review: PassageReview,
  handle: string,
  via: HumanApprovalChannel,
  lastReviewedAt: string,
): PassageReview | null {
  const humanApproved = review.status === 'approved' && review.method === 'human';
  const known = humanApproved && review.reviewers.includes(handle);
  if (known && review.approvedVia === via && review.lastReviewedAt === lastReviewedAt) return null;
  const reviewers = !humanApproved ? [handle] : known ? [...review.reviewers] : [...review.reviewers, handle];
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

/** JSON with object keys sorted, so equal values serialise equally. */
function canonicalJson(value: unknown): string {
  const canon = (inner: unknown): unknown =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner)
            .sort(([x], [y]) => (x < y ? -1 : 1))
            .map(([key, nested]) => [key, canon(nested)]),
        )
      : Array.isArray(inner)
        ? inner.map(canon)
        : inner;
  return JSON.stringify(canon(value));
}

/** SHA-256 (hex) of a passage or translation without its review block, independent of key order and formatting. */
export function passageContentHash(passage: Passage | TranslatedPassage): string {
  const { review: _review, ...content } = passage;
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

/** The review block after an auto approval at `lastReviewedAt`, or `null` when `review` already records it. */
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
  return canonicalJson(review) === canonicalJson(target) ? null : target;
}

function checked<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new ReviewError((error as Error).message);
  }
}

/** A passage or translation file read for approval, with its validator for the updated value. */
interface ReviewedFile {
  readonly value: Passage | TranslatedPassage;
  readonly text: string;
  readonly translation: boolean;
  /** Validates the file with `review` in place of its review block. */
  readonly withReview: (review: PassageReview) => Passage | TranslatedPassage;
}

function readContent(fs: ReviewFs, file: string): ReviewedFile {
  const place = translationPlaceOf(file);
  if (place === null && contentKindOf(file) !== 'passage') {
    throw new ReviewError(`${file}: not a passage file (passages/<key>.json or passages/i18n/<locale>/<key>.json)`);
  }
  let text: string;
  try {
    text = fs.readFile(file);
  } catch (error) {
    throw new ReviewError(`${file}: cannot read file (${(error as Error).message})`);
  }
  if (place !== null) {
    const value = checked(() => checkTranslatedPassage(parseJson(text, file), file, place));
    return {
      value,
      text,
      translation: true,
      withReview: (review) => checked(() => checkTranslatedPassage({ ...value, review }, file, place)),
    };
  }
  const value = checked(() => checkPassage(parseJson(text, file), file, basename(file, '.json')));
  return {
    value,
    text,
    translation: false,
    withReview: (review) => checked(() => checkPassage({ ...value, review }, file)),
  };
}

interface PlannedWrite {
  readonly file: string;
  readonly text: string;
  readonly original: string;
}

/** The temporary file a write goes through before it is renamed into place. */
export function tempPathFor(file: string): string {
  return `${file}.lectio-review-${String(process.pid)}.tmp`;
}

/** Runs `fn`, ignoring any error: used for best-effort cleanup after a failure. */
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // The original error is what the caller sees.
  }
}

/**
 * Writes every file as one set: each text goes to a temporary file next to its target, then each
 * is renamed into place. On any failure, the targets already replaced get their original text
 * back, every temporary file is removed, and the error is rethrown.
 */
function writeAll(fs: ReviewFs, writes: readonly PlannedWrite[]): void {
  const replaced: PlannedWrite[] = [];
  try {
    for (const { file, text } of writes) fs.writeFile(tempPathFor(file), text);
    for (const write of writes) {
      fs.rename(tempPathFor(write.file), write.file);
      replaced.push(write);
    }
  } catch (error) {
    for (const { file, original } of replaced.reverse()) {
      attempt(() => {
        fs.writeFile(tempPathFor(file), original);
        fs.rename(tempPathFor(file), file);
      });
    }
    for (const { file } of writes) attempt(() => fs.remove(tempPathFor(file)));
    throw error;
  }
}

/** Applies `update` to every file's review block, validates all of them, then writes the changed ones. */
async function applyReview(
  files: readonly string[],
  update: (review: PassageReview) => PassageReview | null,
  options: WriteOptions,
  auto = false,
): Promise<ApprovalOutcome[]> {
  const fs = options.fs ?? nodeReviewFs;
  const formatJson = options.format ?? prettierJson;
  if (files.length === 0) throw new ReviewError('no files to approve');
  // One plan per file: `X.json ./X.json` names the same file twice, and two writes to it would collide.
  const seen = new Set<string>();
  const unique = files.filter((file) => !seen.has(resolve(file)) && seen.add(resolve(file)));
  const planned = unique.map((file) => {
    const { value, text, translation, withReview } = readContent(fs, file);
    if (translation && auto) {
      throw new ReviewError(`${file}: translations are approved by a person only, never automatically`);
    }
    const review = update(value.review as PassageReview);
    const next = review === null ? null : withReview(review);
    return { file, original: text, next, contentHash: passageContentHash(value) };
  });
  const outcomes: ApprovalOutcome[] = [];
  const writes: PlannedWrite[] = [];
  for (const { file, original, next, contentHash } of planned) {
    if (next !== null) writes.push({ file, text: await formatJson(next, file), original });
    outcomes.push({ file, changed: next !== null, contentHash });
  }
  writeAll(fs, writes);
  return outcomes;
}

/**
 * Records a human approval on each passage or translation file: `status: approved`, `method: human`, the
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
 * `approvedVia: auto`, no reviewers, `lastReviewedAt` and the verifier summary. Refuses translation
 * files: they are approved by a person only.
 */
export async function approveAuto(
  files: readonly string[],
  verifierSummary: VerifierSummary,
  now: Date | string,
  options: WriteOptions = {},
): Promise<ApprovalOutcome[]> {
  checkVerifierSummary(verifierSummary);
  const at = reviewTimestamp(now);
  return applyReview(files, (review) => autoReview(review, verifierSummary, at), options, true);
}
