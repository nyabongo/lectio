/**
 * A simulated content-gates.yml on the fake GitHub: the repository with every workflow of the
 * required-check registry, a pending passage PR, a `PrCheckout` over the fake's commits, gate
 * results for each path, and `simulateRun`, which plays one workflow run (changes → deterministic
 * → merge-rule → merge) and records each job's check run on the head it ran on.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { FakeGitHubClient } from '@lectio/providers';
import type { PrFile, WorkflowRun } from '@lectio/providers';

import type { ChangedFile } from '../../core/git.ts';
import type { GateResult } from '../../core/result.ts';
import { APPROVAL_WORKFLOW } from '../../merge-rule/index.ts';
import type { FormatJson } from '../../review/approve.ts';
import type { CommitLink, PrCheckout } from '../checkout.ts';
import { ACTIONS_BOT, CHECKS_WORKFLOW } from '../facts.ts';
import { runMergeJob } from '../merge-job.ts';
import type { MergeJobOutcome } from '../merge-job.ts';
import { runMergeRuleJob } from '../merge-rule-job.ts';
import type { MergeRuleJobOutcome } from '../merge-rule-job.ts';
import { readRequiredChecks } from '../registry.ts';
import type { RequiredChecksRegistry } from '../registry.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, '../../../../..');

export const PASSAGE = 'passages/MT.20.1-16.json';
export const PASSAGE_TEXT = readFileSync(join(here, '../../review/fixtures/passages/MT.20.1-16.json'), 'utf8');
export const CLAIM_IDS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;

export const REVIEWER = 'nyabongo';
export const STRANGER = 'someone-else';
export const CONFIG: LectioConfig = DEFAULT_CONFIG;

/** The real registry, read from `.github/required-checks/` of this checkout. */
export const REGISTRY: RequiredChecksRegistry = readRequiredChecks(REPO_ROOT);

/** What the merge job waits for: the registry's checks and the merge-rule check (Checks API). */
export const REQUIRED_CHECKS: readonly string[] = [...REGISTRY.checks, 'merge-rule'];

/** Jobs each registered workflow reports, from the registry files themselves. */
export function registryJobs(): Record<string, readonly string[]> {
  const dir = join(REPO_ROOT, '.github/required-checks');
  return Object.fromEntries(
    REGISTRY.workflows.map((workflow) => {
      const file = join(dir, workflow.replace(/\.ya?ml$/, '.json'));
      return [workflow, (JSON.parse(readFileSync(file, 'utf8')) as { jobs: string[] }).jobs];
    }),
  );
}

/** Formatting without Prettier: stable two-space JSON. */
export const plainJson: FormatJson = async (value) => `${JSON.stringify(value, null, 2)}\n`;

/** The fake repository as github-actions[bot], with every registry workflow dispatchable. */
export function newRepo(files: Readonly<Record<string, string>> = { 'README.md': '# Lectio\n' }): FakeGitHubClient {
  const workflows = Object.fromEntries(
    Object.entries(registryJobs()).map(([workflow, jobs]) => [
      workflow,
      // The content workflows report their checks from the simulated runs, not on dispatch.
      workflow === CHECKS_WORKFLOW ? {} : { jobs },
    ]),
  );
  return new FakeGitHubClient({
    actor: ACTIONS_BOT,
    files,
    requiredChecks: REQUIRED_CHECKS,
    workflows: { ...workflows, [APPROVAL_WORKFLOW]: {}, 'deploy.yml': {} },
  });
}

/** A same-repository PR by `author` that adds `files` on branch `branch`. */
export async function openPr(
  bot: FakeGitHubClient,
  author: string,
  files: Readonly<Record<string, string | null>> = { [PASSAGE]: PASSAGE_TEXT },
  branch = 'research/mt-20',
): Promise<number> {
  const person = bot.as(author);
  await person.createBranch({ name: branch });
  await person.pushCommit({
    branch,
    message: 'Add passage',
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
  });
  const { pr } = await person.openOrUpdatePr({ head: branch, title: `Content: ${branch}`, body: '' });
  return pr.number;
}

/** A content commit by `author` on the PR branch. */
export async function pushContent(bot: FakeGitHubClient, author: string, branch: string, text: string): Promise<void> {
  await bot.as(author).pushCommit({ branch, message: 'Fix passage', files: [{ path: PASSAGE, content: text }] });
}

const STATUS: Readonly<Record<PrFile['status'], ChangedFile['status']>> = {
  added: 'added',
  modified: 'modified',
  removed: 'deleted',
  renamed: 'renamed',
};

/**
 * A {@link PrCheckout} over the fake: the PR's current head, its files and its commits since `base`.
 * `nonRegular` lists the changed paths to treat as symbolic links (the fake has no file modes).
 */
export async function fakeCheckout(
  bot: FakeGitHubClient,
  number: number,
  base = 'main',
  nonRegular: readonly string[] = [],
): Promise<PrCheckout> {
  const pr = await bot.getPr(number);
  const files = (await bot.getPrFiles(number)).map((file): ChangedFile => ({
    path: file.path,
    status: STATUS[file.status],
    ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
  }));
  const onBase = new Set<string>();
  for (const pending = [bot.headOf(base)]; pending.length > 0;) {
    const sha = pending.pop() as string;
    if (onBase.has(sha)) continue;
    onBase.add(sha);
    pending.push(...(await bot.getCommit(sha)).parents);
  }
  const links: CommitLink[] = [];
  const seen = new Set<string>();
  for (const pending = [pr.headSha]; pending.length > 0;) {
    const sha = pending.pop() as string;
    if (onBase.has(sha) || seen.has(sha)) continue;
    seen.add(sha);
    const commit = await bot.getCommit(sha);
    links.push({ sha, parents: commit.parents });
    pending.push(...commit.parents);
  }
  const regular = (path: string): boolean => !nonRegular.includes(path);
  return {
    changedFiles: () => files,
    nonRegular: () => [...nonRegular],
    show: (ref, path) => (regular(path) ? (bot.fileAt(ref, path) ?? null) : null),
    revList: () => links,
    readFile: (path) => (regular(path) ? (bot.fileAt(pr.headSha, path) ?? null) : null),
  };
}

export const DETERMINISTIC_PASS: readonly GateResult[] = ['schema', 'evidence', 'licence'].map((gate) => ({
  gate,
  status: 'pass',
  items: [],
  meta: {},
}));

export const SCHEMA_FAIL: readonly GateResult[] = [
  {
    gate: 'schema',
    status: 'fail',
    items: [{ ruleId: 'schema/valid', severity: 'error', file: PASSAGE, pointer: '', message: 'broken' }],
    meta: {},
  },
  ...DETERMINISTIC_PASS.slice(1),
];

export const SUMMARY = {
  confirmer: { model: 'claude-sonnet-5-5', minSupport: 0.95 },
  refuter: { model: 'gpt-5', minSupport: 0.93 },
  minSupport: 0.93,
  refutations: 0,
  sensitive: 0,
};

/** The verifiers result: every claim of the passage at `support` by both verifiers. */
export function verifierResult(support = 0.95, summary: unknown = SUMMARY): GateResult {
  const verdict = { verdict: 'supported', support, sensitive: false };
  return {
    gate: 'verifiers',
    status: support >= 0.9 ? 'pass' : 'flag',
    items:
      support >= 0.9
        ? []
        : [{ ruleId: 'verifiers/claim-supported', severity: 'warning', file: PASSAGE, pointer: '', message: 'low' }],
    meta: {
      claims: CLAIM_IDS.map((claimId) => ({
        file: PASSAGE,
        claimId,
        sensitive: false,
        confirmer: verdict,
        refuter: verdict,
      })),
      files: { [PASSAGE]: { verifierSummary: summary } },
    },
  };
}

/** Gates green and both verifiers sure: auto-merge. */
export const AUTO_RESULTS: readonly GateResult[] = [...DETERMINISTIC_PASS, verifierResult()];
/** Gates green, verifiers unsure: needs review. */
export const FLAGGED_RESULTS: readonly GateResult[] = [...DETERMINISTIC_PASS, verifierResult(0.5, null)];

export interface SimulatedRun {
  readonly run: WorkflowRun;
  readonly headSha: string;
  readonly mergeRule: MergeRuleJobOutcome;
  readonly merge: MergeJobOutcome | null;
}

export interface SimulateOptions {
  /**
   * The trusted run's event: `workflow_run` (a PR-side `pull_request` run completed),
   * `issue_comment` (`/approve`) or `workflow_dispatch` (on main, by the merge-rule job).
   */
  readonly event: 'workflow_run' | 'issue_comment' | 'workflow_dispatch';
  readonly results: readonly GateResult[];
  /** An existing trusted run (a dispatched one) instead of a new one. */
  readonly run?: WorkflowRun;
  readonly config?: LectioConfig;
  readonly now?: Date;
  /** Changed paths the checkout reports as symbolic links. */
  readonly nonRegular?: readonly string[];
}

/** The PR-side content-checks.yml run on the PR head: GitHub's observation of it, and its two checks. */
export function contentChecksRun(bot: FakeGitHubClient, number: number, headSha: string, branch: string): WorkflowRun {
  bot.setCheck(headSha, 'changes', 'success');
  bot.setCheck(headSha, 'deterministic', 'success');
  return bot.addWorkflowRun({
    workflowFile: CHECKS_WORKFLOW,
    event: 'pull_request',
    headSha,
    headBranch: branch,
    prNumbers: [number],
    status: 'completed',
    conclusion: 'success',
    actor: 'someone',
  });
}

/**
 * One run of the trusted content-gates.yml (main's copy) for PR `number` on its current head, as the
 * workflow plays it: (for `workflow_run`, the PR-side run first) merge-rule `decide`, then, when an
 * approval commit is due, `approve`, the artifact upload naming that commit and `dispatch`, and the merge job when the
 * head is a valid approval commit. Its jobs report on main's tip; `merge-rule` reaches the PR head
 * through the Checks API.
 */
export async function simulateRun(
  bot: FakeGitHubClient,
  number: number,
  options: SimulateOptions,
): Promise<SimulatedRun> {
  const pr = await bot.getPr(number);
  const headSha = pr.headSha;
  if (options.event === 'workflow_run') contentChecksRun(bot, number, headSha, pr.head);
  const run =
    options.run ??
    bot.addWorkflowRun({
      workflowFile: APPROVAL_WORKFLOW,
      event: options.event,
      headSha: bot.headOf('main'),
      headBranch: 'main',
      prNumbers: [],
      status: 'in_progress',
      conclusion: null,
      actor: pr.author,
    });
  const input = {
    github: bot,
    config: options.config ?? CONFIG,
    checkout: await fakeCheckout(bot, number, 'main', options.nonRegular),
    registry: REGISTRY,
    prNumber: number,
    headSha,
    base: 'main',
    defaultBranch: 'main',
    runId: String(run.id),
    results: options.results,
    format: plainJson,
    now: () => options.now ?? new Date('2026-10-05T12:00:00Z'),
    log: () => undefined,
  };
  let mergeRule = await runMergeRuleJob({ ...input, phase: 'decide' });
  if (mergeRule.write) {
    mergeRule = await runMergeRuleJob({ ...input, phase: 'approve' });
    if (mergeRule.approvalArtifact !== undefined) {
      bot.addRunArtifact(run.id, mergeRule.approvalArtifact);
      const approve = mergeRule;
      const dispatched = await runMergeRuleJob({
        ...input,
        phase: 'dispatch',
        approvalCommitSha: approve.approvalCommitSha as string,
      });
      mergeRule = { ...approve, exitCode: dispatched.exitCode, dispatched: dispatched.dispatched };
    }
  }
  const merge =
    mergeRule.decision === 'approved-commit' && !mergeRule.manualMerge
      ? await runMergeJob({ github: bot, prNumber: number, sha: headSha, log: () => undefined })
      : null;
  return { run, headSha, mergeRule, merge };
}

/** The trusted content-gates.yml run the merge-rule job dispatched last (`null` when none). */
export async function lastDispatchedGatesRun(bot: FakeGitHubClient): Promise<WorkflowRun | null> {
  const dispatch = bot.dispatches.filter((entry) => entry.file === APPROVAL_WORKFLOW).at(-1);
  return dispatch === undefined ? null : bot.getWorkflowRun(dispatch.runId);
}

/** Plays the PR-side content-checks.yml run the merge-rule job dispatched on the approval commit. */
export function dispatchedChecksReport(bot: FakeGitHubClient, sha: string): void {
  bot.setCheck(sha, 'changes', 'success');
  bot.setCheck(sha, 'deterministic', 'success');
}
