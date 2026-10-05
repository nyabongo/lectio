/**
 * The approval commit: the review block written with the L-023 helper (`approveHuman` /
 * `approveAuto`) and one commit through the Git Data API, so GitHub signs it as
 * github-actions[bot], with the trailer `Lectio-Approval: <human|auto> run=<run id> head=<sha>`.
 *
 * The helper runs on an in-memory copy of the changed passages read from the PR head: nothing in
 * the PR's working tree is written or executed. Files are formatted with the tooling checkout's
 * Prettier config (`toolRoot`), never with one the PR brings (a `.prettierrc.cjs` would be code).
 * PR files are read as regular-file blobs (`PrCheckout`), so a symbolic link never reaches a commit.
 */
import { join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { contentKindOf, translationPlaceOf } from '@lectio/content';
import type { FileChange, GitCommit, GitHubClient } from '@lectio/providers';
import { format, resolveConfig } from 'prettier';

import type { ChangedFile } from '../core/git.ts';
import type { GateResult } from '../core/result.ts';
import type { PullRequestApproval } from '../core/pull-request.ts';
import { VERIFIERS_GATE_ID, formatApprovalTrailer } from '../merge-rule/index.ts';
import type { ApprovalKind } from '../merge-rule/index.ts';
import { approveAuto, approveHuman } from '../review/approve.ts';
import type { FormatJson, ReviewFs, VerifierSummary } from '../review/approve.ts';
import type { PrCheckout } from './checkout.ts';

/** Prettier for passage JSON with the config that applies to `path` in the tooling checkout. */
export function toolPrettierJson(toolRoot: string): FormatJson {
  return async (value, path) => {
    const config = await resolveConfig(join(toolRoot, path));
    return format(JSON.stringify(value, null, 2), { ...config, parser: 'json', filepath: path });
  };
}

/** A {@link ReviewFs} over the PR head that keeps every write in memory. */
export function memoryReviewFs(readFile: (path: string) => string | null): ReviewFs & {
  readonly written: ReadonlyMap<string, string>;
} {
  const written = new Map<string, string>();
  const temporary = new Map<string, string>();
  return {
    written,
    readFile(path) {
      const text = written.get(path) ?? readFile(path);
      if (text === null) throw new Error(`${path}: no such file in the PR head`);
      return text;
    },
    writeFile(path, text) {
      temporary.set(path, text);
    },
    rename(from, to) {
      const text = temporary.get(from);
      if (text === undefined) throw new Error(`${from}: nothing to rename`);
      temporary.delete(from);
      written.set(to, text);
    },
    remove(path) {
      temporary.delete(path);
    },
  };
}

/**
 * The changed passage and translation (`passages/i18n/<locale>/<key>.json`) files the review block
 * is written to (deleted files excluded), sorted. Translations only ever reach the human path:
 * `decide` never auto-merges them and `approveAuto` refuses them.
 */
export function approvedPassages(changedFiles: readonly ChangedFile[]): string[] {
  return changedFiles
    .filter(
      (file) =>
        file.status !== 'deleted' && (contentKindOf(file.path) === 'passage' || translationPlaceOf(file.path) !== null),
    )
    .map((file) => file.path)
    .sort();
}

/** `meta.files[file].verifierSummary` of the verifiers result, or `null`. */
export function verifierSummaryFor(results: readonly GateResult[], file: string): VerifierSummary | null {
  const verifiers = results.find((result) => result.gate === VERIFIERS_GATE_ID);
  const files = verifiers?.meta['files'];
  if (files === null || typeof files !== 'object') return null;
  const entry = (files as Record<string, unknown>)[file];
  if (entry === null || typeof entry !== 'object') return null;
  const summary = (entry as { verifierSummary?: unknown }).verifierSummary;
  return summary === null || typeof summary !== 'object' ? null : (summary as VerifierSummary);
}

export type ApprovalWrite =
  | { readonly kind: 'human'; readonly approval: PullRequestApproval }
  | { readonly kind: 'auto'; readonly results: readonly GateResult[]; readonly now: Date };

export interface ApprovalCommitInput {
  readonly github: GitHubClient;
  readonly config: LectioConfig;
  readonly checkout: PrCheckout;
  readonly changedFiles: readonly ChangedFile[];
  readonly prNumber: number;
  readonly branch: string;
  /** The head sha the decision was made on: the commit's parent and the trailer's `head`. */
  readonly headSha: string;
  /** This workflow run's id (`GITHUB_RUN_ID`). */
  readonly runId: string;
  readonly write: ApprovalWrite;
  readonly format: FormatJson;
}

export interface ApprovalCommitResult {
  readonly commit: GitCommit;
  /** Passage files whose review block changed. */
  readonly reviewed: readonly string[];
}

/** Why an approval commit cannot be written; the job ends red with this message. */
export class ApprovalCommitError extends Error {
  override readonly name = 'ApprovalCommitError';
}

async function reviewChanges(input: ApprovalCommitInput): Promise<FileChange[]> {
  const { write, config, checkout } = input;
  const passages = approvedPassages(input.changedFiles);
  if (passages.length === 0) return [];
  const fs = memoryReviewFs((path) => checkout.readFile(path));
  if (write.kind === 'human') {
    await approveHuman(passages, {
      reviewer: write.approval.handle,
      via: write.approval.via,
      now: write.approval.at,
      config,
      fs,
      format: input.format,
    });
  } else {
    for (const file of passages) {
      const summary = verifierSummaryFor(write.results, file);
      if (summary === null) throw new ApprovalCommitError(`${file} has no verifierSummary from live verifiers`);
      await approveAuto([file], summary, write.now, { fs, format: input.format });
    }
  }
  return [...fs.written].map(([path, content]) => ({ path, content }));
}

/** The commit message of an approval commit. */
export function approvalMessage(kind: ApprovalKind, prNumber: number, runId: string, headSha: string): string {
  const what = kind === 'human' ? 'human approval' : 'auto-merge approval';
  return `Record ${what} for #${String(prNumber)}\n\n${formatApprovalTrailer({ kind, runId, head: headSha })}\n`;
}

/**
 * Writes the review blocks and the approval commit on `branch`, refusing when the branch head is no
 * longer `headSha`. Only validated passage and translation JSON is ever written; when no review
 * block changes (a PR without passages), the commit changes no file and only records the approval.
 */
export async function writeApprovalCommit(input: ApprovalCommitInput): Promise<ApprovalCommitResult> {
  const changes = await reviewChanges(input);
  const commit = await input.github.commitFiles({
    branch: input.branch,
    message: approvalMessage(input.write.kind, input.prNumber, input.runId, input.headSha),
    files: changes,
    expectedHeadSha: input.headSha,
    allowEmpty: true,
  });
  return { commit, reviewed: changes.map((change) => change.path) };
}
