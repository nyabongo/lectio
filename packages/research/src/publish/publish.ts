/**
 * Step 5 of a research run: open one pull request per passage (`research.prGrouping: 'passage'`).
 *
 * For each passage it validates the passage, writes `passages/<key>.json` in one commit on the
 * branch `research/<key>` (through `GitHubClient.commitFiles`, so GitHub signs it) with the
 * `Lectio-Research` attribution trailer, and opens the PR with the `research` label.
 *
 * Re-running is idempotent: an open PR on the branch is updated in place (title, body, label;
 * the gate section between the `lectio-gates` markers is kept), and a new commit is pushed only
 * when the files differ from what the PR body records.
 *
 * It never overwrites or revives human decisions: it refuses (`PublishRefusedError`) when the
 * branch exists without an open PR, when a person closed the passage's PR, or when the open PR's
 * head is not a research commit for this passage or the merge rule's approval commit. Publishing
 * never closes a PR, and never touches a fork PR that happens to use a `research/` branch name.
 */
import type { LectioConfig, ResearchConfig, ReviewerConfig } from '@lectio/config';
import { PASSAGES_DIR, checkPassage } from '@lectio/content';
import { ProviderError, sha256Hex, stableStringify } from '@lectio/providers';
import type { FileChange, GitCommit, GitHubClient, PullRequest } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { researchBranch } from '../plan/plan.ts';

import { RESEARCH_TRAILER, commitMessage, hashInBody, keepGates, prBody, prTitle } from './body.ts';
import { formatJson } from './format-json.ts';

/** Label on every research PR. */
export const RESEARCH_LABEL = 'research';

/** Login of the merge-rule job that writes the approval commit (L-031). */
export const APPROVAL_AUTHOR = 'github-actions[bot]';

/** Trailer of the approval commit (decision 003). */
export const APPROVAL_TRAILER = 'Lectio-Approval';

/** One researched passage to publish. */
export interface PublishItem {
  readonly passage: Passage;
  /** The passage's calendar dates in the run's window (the planner's `WorkItem.dates`). */
  readonly dates?: readonly string[];
  /** What researching it cost; defaults to `passage.provenance.costUsd`. */
  readonly costUsd?: number;
}

export interface PublishOptions {
  readonly github: Pick<GitHubClient, 'listPrs' | 'createBranch' | 'commitFiles' | 'getCommit' | 'openOrUpdatePr'>;
  readonly config: {
    readonly reviewer: Pick<ReviewerConfig, 'githubHandles' | 'approvalLabel' | 'approvalCommand'>;
    readonly research: Pick<ResearchConfig, 'prGrouping'>;
  };
  /** Base branch of new PRs and of new research branches. Default: the repository's default branch. */
  readonly base?: string;
}

export interface PublishResult {
  readonly key: string;
  readonly branch: string;
  readonly pr: PullRequest;
  /** True when this run opened the PR, false when it updated an open one. */
  readonly created: boolean;
  /** The commit this run pushed, or `null` when the open PR already had these files. */
  readonly commit: GitCommit | null;
  /** Repository paths the commit carries. */
  readonly files: readonly string[];
}

export type PublishOutcome =
  | ({ readonly ok: true } & PublishResult)
  | {
      readonly ok: false;
      readonly key: string;
      /** True when the passage was skipped on purpose (a person closed its PR) rather than failing. */
      readonly skipped: boolean;
      readonly error: Error;
    };

/**
 * Why publishing refused a passage, leaving GitHub untouched:
 * - `leftover-branch`: `research/<key>` exists without an open PR (a person deletes it to re-research);
 * - `closed-pr`: a person closed the passage's research PR, and research never re-opens one;
 * - `foreign-head`: the open PR's head is a commit research did not write (for example a reviewer's push).
 */
export type RefusalReason = 'leftover-branch' | 'closed-pr' | 'foreign-head';

export class PublishRefusedError extends Error {
  override readonly name = 'PublishRefusedError';
  readonly reason: RefusalReason;
  readonly branch: string;
  readonly pr: number | undefined;

  constructor(reason: RefusalReason, message: string, branch: string, pr?: number) {
    super(message);
    this.reason = reason;
    this.branch = branch;
    this.pr = pr;
  }
}

/** Repository path of a passage file. */
export function passagePath(key: string): string {
  return `${PASSAGES_DIR}/${key}.json`;
}

/** The files one passage's commit carries: the passage file only. */
export function passageFiles(passage: Passage): FileChange[] {
  return [{ path: passagePath(passage.key), content: formatJson(passage) }];
}

/** sha256 over the paths and contents of a commit's files. */
export function filesHash(files: readonly FileChange[]): string {
  return sha256Hex(stableStringify(files));
}

/** The groups `research.prGrouping` puts items in, one PR per group. Only `passage` exists. */
export function groupItems<T extends PublishItem>(
  items: readonly T[],
  grouping: LectioConfig['research']['prGrouping'],
): T[][] {
  if (grouping !== 'passage') throw new RangeError(`unsupported research.prGrouping: ${JSON.stringify(grouping)}`);
  const seen = new Set<string>();
  for (const { passage } of items) {
    if (seen.has(passage.key)) throw new RangeError(`passage ${passage.key} is listed more than once`);
    seen.add(passage.key);
  }
  return items.map((item) => [item]);
}

function checkItem(item: PublishItem): Passage {
  const path = passagePath(item.passage.key);
  const passage = checkPassage(item.passage, path, item.passage.key);
  if (passage.review.status !== 'pending') {
    throw new RangeError(
      `${path}: research publishes pending passages only, got review.status ${JSON.stringify(passage.review.status)}`,
    );
  }
  return passage;
}

/**
 * Whether research may commit on top of `head`: only its own commit for this passage, or the
 * merge rule's approval commit (which a new research commit supersedes, resetting approval).
 */
export function isReplaceableHead(head: Pick<GitCommit, 'message' | 'author'>, key: string): boolean {
  const lines = head.message.split('\n');
  if (lines.some((line) => line.startsWith(`${RESEARCH_TRAILER}: key=${key} `))) return true;
  return head.author === APPROVAL_AUTHOR && lines.some((line) => line.startsWith(`${APPROVAL_TRAILER}: `));
}

async function createBranch(github: PublishOptions['github'], name: string, base: string | undefined): Promise<void> {
  try {
    await github.createBranch(base === undefined ? { name } : { name, from: base });
  } catch (error) {
    if (error instanceof ProviderError && error.code === 'conflict') {
      throw new PublishRefusedError(
        'leftover-branch',
        `branch ${name} exists without an open PR; delete it to re-research this passage`,
        name,
      );
    }
    throw error;
  }
}

/** Publishes one passage: commit on `research/<key>`, then open or update its PR. */
export async function publishPassage(item: PublishItem, options: PublishOptions): Promise<PublishResult> {
  const { github, config, base } = options;
  groupItems([item], config.research.prGrouping);
  const passage = checkItem(item);
  const branch = researchBranch(passage.key);
  const files = passageFiles(passage);
  const contentHash = filesHash(files);

  const prs = (await github.listPrs({ state: 'all', head: branch })).filter((pr) => !pr.fork && pr.head === branch);
  const open = prs.find((pr) => pr.state === 'open');
  if (open === undefined) {
    const closed = prs.findLast((pr) => pr.state === 'closed');
    if (closed !== undefined) {
      throw new PublishRefusedError(
        'closed-pr',
        `PR #${String(closed.number)} on ${branch} was closed without merging; research does not re-open it`,
        branch,
        closed.number,
      );
    }
    await createBranch(github, branch, base);
  }

  let commit: GitCommit | null = null;
  if (open === undefined || hashInBody(open.body, passage.key) !== contentHash) {
    if (open !== undefined && !isReplaceableHead(await github.getCommit(open.headSha), passage.key)) {
      throw new PublishRefusedError(
        'foreign-head',
        `PR #${String(open.number)} head ${open.headSha.slice(0, 12)} is not a research or approval commit; ` +
          'someone else changed the branch, so research will not commit over it',
        branch,
        open.number,
      );
    }
    commit = await github.commitFiles({
      branch,
      message: commitMessage(passage),
      files,
      ...(open === undefined ? {} : { expectedHeadSha: open.headSha }),
    });
  }

  const body = prBody({
    passage,
    path: passagePath(passage.key),
    dates: item.dates ?? [],
    ...(item.costUsd === undefined ? {} : { costUsd: item.costUsd }),
    contentHash,
    reviewer: config.reviewer,
  });
  const { pr, created } = await github.openOrUpdatePr({
    head: branch,
    ...(base === undefined ? {} : { base }),
    title: prTitle(passage),
    body: open === undefined ? body : keepGates(body, open.body),
    labels: [RESEARCH_LABEL],
  });
  return { key: passage.key, branch, pr, created, commit, files: files.map((file) => file.path) };
}

/**
 * Publishes every item, one PR per `research.prGrouping` group, in order. A failure or refusal on
 * one passage is recorded and the rest still publish; nothing already published is undone or closed.
 */
export async function publishAll(items: readonly PublishItem[], options: PublishOptions): Promise<PublishOutcome[]> {
  const outcomes: PublishOutcome[] = [];
  for (const [item] of groupItems(items, options.config.research.prGrouping) as [PublishItem][]) {
    try {
      outcomes.push({ ok: true, ...(await publishPassage(item, options)) });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const skipped = failure instanceof PublishRefusedError && failure.reason === 'closed-pr';
      outcomes.push({ ok: false, key: item.passage.key, skipped, error: failure });
    }
  }
  return outcomes;
}
