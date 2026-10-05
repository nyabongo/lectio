/**
 * Step 5 of a research run: open one pull request per passage (`research.prGrouping: 'passage'`).
 *
 * For each passage it validates the passage, writes `passages/<key>.json` in one commit on the
 * branch `research/<key>` (through `GitHubClient.commitFiles`, so GitHub signs it) with the
 * `Lectio-Research` attribution trailer, and opens the PR with the `research` label.
 *
 * Re-running is idempotent: an open PR on the branch is updated in place (title, body, label),
 * and a new commit is pushed only when the files differ from what the PR body records. Publishing
 * never closes a PR, and never touches a fork PR that happens to use a `research/` branch name.
 */
import type { LectioConfig, ResearchConfig, ReviewerConfig } from '@lectio/config';
import { PASSAGES_DIR, checkPassage } from '@lectio/content';
import { ProviderError, sha256Hex, stableStringify } from '@lectio/providers';
import type { FileChange, GitCommit, GitHubClient, PullRequest } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { researchBranch } from '../plan/plan.ts';

import { commitMessage, hashInBody, prBody, prTitle } from './body.ts';
import { formatJson } from './format-json.ts';

/** Label on every research PR. */
export const RESEARCH_LABEL = 'research';

/** One researched passage to publish. */
export interface PublishItem {
  readonly passage: Passage;
  /** The passage's calendar dates in the run's window (the planner's `WorkItem.dates`). */
  readonly dates?: readonly string[];
  /** What researching it cost; defaults to `passage.provenance.costUsd`. */
  readonly costUsd?: number;
}

export interface PublishOptions {
  readonly github: Pick<GitHubClient, 'listPrs' | 'createBranch' | 'commitFiles' | 'openOrUpdatePr'>;
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
  ({ readonly ok: true } & PublishResult) | { readonly ok: false; readonly key: string; readonly error: Error };

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
    throw new RangeError(`${path}: research publishes pending passages only, got review.status "approved"`);
  }
  return passage;
}

async function ensureBranch(github: PublishOptions['github'], name: string, base: string | undefined): Promise<void> {
  try {
    await github.createBranch(base === undefined ? { name } : { name, from: base });
  } catch (error) {
    // A branch left from an earlier run (its PR closed): commit on top of it.
    if (!(error instanceof ProviderError && error.code === 'conflict')) throw error;
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

  const open = (await github.listPrs({ state: 'open', head: branch })).find((pr) => !pr.fork && pr.head === branch);
  if (open === undefined) await ensureBranch(github, branch, base);

  const commit =
    open !== undefined && hashInBody(open.body, passage.key) === contentHash
      ? null
      : await github.commitFiles({
          branch,
          message: commitMessage(passage),
          files,
          ...(open === undefined ? {} : { expectedHeadSha: open.headSha }),
        });

  const { pr, created } = await github.openOrUpdatePr({
    head: branch,
    ...(base === undefined ? {} : { base }),
    title: prTitle(passage),
    body: prBody({
      passage,
      path: passagePath(passage.key),
      dates: item.dates ?? [],
      ...(item.costUsd === undefined ? {} : { costUsd: item.costUsd }),
      contentHash,
      reviewer: config.reviewer,
    }),
    labels: [RESEARCH_LABEL],
  });
  return { key: passage.key, branch, pr, created, commit, files: files.map((file) => file.path) };
}

/**
 * Publishes every item, one PR per `research.prGrouping` group, in order. A failure on one
 * passage is recorded and the rest still publish; nothing already published is undone or closed.
 */
export async function publishAll(items: readonly PublishItem[], options: PublishOptions): Promise<PublishOutcome[]> {
  const outcomes: PublishOutcome[] = [];
  for (const [item] of groupItems(items, options.config.research.prGrouping) as [PublishItem][]) {
    try {
      outcomes.push({ ok: true, ...(await publishPassage(item, options)) });
    } catch (error) {
      outcomes.push({
        ok: false,
        key: item.passage.key,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return outcomes;
}
