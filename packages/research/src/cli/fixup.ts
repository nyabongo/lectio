/**
 * `research fixup --pr <n>`: take an open research PR whose gates found something a repair can
 * address, run the pre-validation repair loop (L-036) on the passage at the PR head with those
 * findings as known problems, and push the result as a new commit on the same branch.
 *
 * It never closes the PR and never commits over someone else's work: it refuses a closed or fork
 * PR, a branch that is not `research/<key>`, and a head that is neither a research commit for the
 * passage nor the merge rule's approval commit. A PR a person already approved is refused unless
 * `--force` is given, because the new commit resets that approval.
 */
import { checkPassage, ContentError, formatIssue } from '@lectio/content';
import type { LectioConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import type { GateResultItem } from '@lectio/gates';
import type {
  Clock,
  CostMeter,
  GitCommit,
  GitHubClient,
  LlmClient,
  LlmFamily,
  ProviderSet,
  PullRequest,
} from '@lectio/providers';
import { PASSAGE_KEY_PATTERN } from '@lectio/schema/common';
import { toIsoDateInZone } from '@lectio/shared';

import { RESEARCH_PROMPT } from '../agent/prompt.ts';
import { RESEARCH_BRANCH_PREFIX } from '../plan/plan.ts';
import { APPROVAL_AUTHOR, APPROVAL_TRAILER, isReplaceableHead, publishPassage } from '../publish/publish.ts';
import { draftPath } from '../validate/gates.ts';
import { REPAIR_PROMPT_VERSION } from '../validate/prompt.ts';
import { draftFromResult, formatValidationReport, preValidate } from '../validate/validate.ts';
import type { ValidationResult } from '../validate/validate.ts';
import {
  GATES_BOT,
  checkHead,
  fixupFindings,
  latestGatesComment,
  parseGatesComment,
  parseGatesReport,
} from './gates-comment.ts';
import type { GateFindings } from './gates-comment.ts';

/** A PR that fix-up will not touch; the message says why and what to do. */
export class FixupRefusedError extends Error {
  override readonly name = 'FixupRefusedError';
}

/** Reads a repository file of a PR at its head or on its base branch (`null` when absent). */
export interface PrFiles {
  head(pr: PullRequest, path: string): Promise<string | null>;
  base(pr: PullRequest, path: string): Promise<string | null>;
}

export interface FixupInput {
  readonly pr: number;
  /** Fix up an approved PR (the new commit resets the approval). */
  readonly force: boolean;
  /** Accept gate output for another head, or that names none. */
  readonly allowStale: boolean;
  /** A downloaded `gates.json` artifact to read instead of the PR comment. */
  readonly report?: string;
}

export interface FixupDeps {
  readonly config: LectioConfig;
  readonly repoRoot: string;
  readonly repo: ContentRepo;
  readonly github: GitHubClient;
  readonly llm: (meter: CostMeter) => LlmClient;
  readonly family: LlmFamily;
  readonly providers: ProviderSet;
  readonly clock: Clock;
  readonly meter: CostMeter;
  readonly dryRun: boolean;
  readonly files: PrFiles;
  /** Reads the `--report` file. */
  readonly readReport: (path: string) => string;
  /** The login whose gates comment is trusted. Default {@link GATES_BOT}. */
  readonly bot?: string;
  readonly format?: (json: string, path: string) => Promise<string>;
}

/**
 * What happened: `pushed` a commit, `unchanged` (the repaired file is what the PR already has),
 * `nothing-to-fix` (no actionable finding and the local gates pass), `abandoned` (repairs did not
 * pass the gates; nothing pushed) or `dry-run` (repaired, not pushed).
 */
export type FixupStatus = 'pushed' | 'unchanged' | 'nothing-to-fix' | 'abandoned' | 'dry-run';

export interface FixupReport {
  readonly pr: PullRequest;
  readonly key: string;
  readonly status: FixupStatus;
  readonly source: string;
  /** The findings handed to the repair loop as known problems. */
  readonly findings: readonly GateResultItem[];
  readonly validation: ValidationResult;
  readonly commit: GitCommit | null;
  readonly spentUsd: number;
  readonly ceilingUsd: number;
  /** Checks an override flag skipped (`--force`, `--allow-stale`), in words. */
  readonly overrides: readonly string[];
  /** The gates comment left findings out for its size: the repair saw only part of them. */
  readonly truncated: boolean;
}

const KEY_SHAPE = new RegExp(PASSAGE_KEY_PATTERN);

function isApprovalCommit(commit: GitCommit): boolean {
  return (
    commit.author === APPROVAL_AUTHOR && commit.message.split('\n').some((l) => l.startsWith(`${APPROVAL_TRAILER}: `))
  );
}

async function checkPr(
  input: FixupInput,
  deps: FixupDeps,
  overrides: string[],
): Promise<{ pr: PullRequest; key: string }> {
  const pr = await deps.github.getPr(input.pr);
  const name = `PR #${String(pr.number)}`;
  if (pr.state !== 'open') throw new FixupRefusedError(`${name} is ${pr.state}; fix-up only works on open PRs`);
  if (pr.fork) throw new FixupRefusedError(`${name} comes from a fork; fix-up only works on research PRs`);
  const key = pr.head.startsWith(RESEARCH_BRANCH_PREFIX) ? pr.head.slice(RESEARCH_BRANCH_PREFIX.length) : '';
  if (!KEY_SHAPE.test(key)) {
    throw new FixupRefusedError(`${name} is on ${pr.head}, not a research/<passage key> branch`);
  }
  const head = await deps.github.getCommit(pr.headSha);
  if (!isReplaceableHead(head, key)) {
    throw new FixupRefusedError(
      `${name} head ${pr.headSha.slice(0, 12)} is not a research or approval commit; ` +
        'someone else changed the branch, so fix-up will not commit over it',
    );
  }
  const approved = pr.labels.includes(deps.config.reviewer.approvalLabel) || isApprovalCommit(head);
  if (approved) {
    if (!input.force) {
      throw new FixupRefusedError(
        `${name} is already approved; a fix-up commit would reset that approval. Pass --force to do it anyway`,
      );
    }
    overrides.push('--force: the PR was already approved; a new commit resets that approval');
  }
  return { pr, key };
}

async function gateFindings(pr: PullRequest, input: FixupInput, deps: FixupDeps): Promise<GateFindings> {
  if (input.report !== undefined) {
    return { source: input.report, ...parseGatesReport(deps.readReport(input.report), input.report) };
  }
  const bot = deps.bot ?? GATES_BOT;
  const comment = latestGatesComment(await deps.github.listComments(pr.number), bot);
  if (comment === undefined) {
    throw new FixupRefusedError(
      `PR #${String(pr.number)} has no gates comment from ${bot} yet; wait for the content gates to finish`,
    );
  }
  return { source: `gates comment ${String(comment.id)} by ${bot}`, ...parseGatesComment(comment.body) };
}

async function headPassage(pr: PullRequest, key: string, path: string, deps: FixupDeps) {
  const text = await deps.files.head(pr, path);
  if (text === null) throw new FixupRefusedError(`PR #${String(pr.number)} head has no ${path}`);
  try {
    return checkPassage(JSON.parse(text) as unknown, path, key);
  } catch (error) {
    if (error instanceof ContentError) {
      const issues = error.issues.map((issue) => formatIssue(error.file, issue)).join('\n');
      throw new FixupRefusedError(`${path} at the PR head is not a valid passage:\n${issues}`);
    }
    throw new FixupRefusedError(`${path} at the PR head is not JSON (${(error as Error).message})`);
  }
}

/** A `readBase` that knows one file's base-branch text (`null`: the file is new). */
export function baseReader(path: string, text: string | null): (file: string) => string | null {
  return (file) => (file === path ? text : null);
}

/** Runs one fix-up. Refusals throw {@link FixupRefusedError}. */
export async function runFixup(input: FixupInput, deps: FixupDeps): Promise<FixupReport> {
  const overrides: string[] = [];
  const { pr, key } = await checkPr(input, deps, overrides);
  const gates = await gateFindings(pr, input, deps);
  const head = checkHead(gates.head, pr.headSha);
  if (head !== 'current') {
    const what =
      head === 'stale'
        ? `is for head ${String(gates.head)}, but PR #${String(pr.number)} is at ${pr.headSha}`
        : `does not name the full commit sha it checked, so it may be about an older head of PR #${String(pr.number)}`;
    if (!input.allowStale) {
      throw new FixupRefusedError(`the ${gates.source} ${what}; wait for the gates to re-run, or pass --allow-stale`);
    }
    overrides.push(`--allow-stale: the ${gates.source} ${what}`);
  }
  const path = draftPath(deps.config, key);
  const passage = await headPassage(pr, key, path, deps);
  const findings = fixupFindings(gates.findings, path);
  const baseText = await deps.files.base(pr, path);

  const now = deps.clock.now();
  const draft = draftFromResult(
    { status: 'written', key, costUsd: passage.provenance.costUsd ?? 0, path, passage },
    { ref: passage.ref },
    {
      locale: passage.locale,
      runId: passage.provenance.runId,
      models: passage.provenance.models,
      family: deps.family,
      promptVersion: RESEARCH_PROMPT,
      createdAt: now.toISOString(),
    },
  );
  const meter = deps.meter.scope(`fixup:${key}`, deps.config.research.budget.perPassageUsd);
  const validation = await preValidate(
    { ...(draft as NonNullable<typeof draft>), knownProblems: findings },
    {
      llm: deps.llm(meter),
      meter,
      config: deps.config,
      providers: deps.providers,
      root: deps.repoRoot,
      repo: deps.repo,
      readBase: baseReader(path, baseText),
      ...(deps.format === undefined ? {} : { format: deps.format }),
    },
  );

  const base = {
    pr,
    key,
    source: gates.source,
    findings,
    validation,
    spentUsd: deps.meter.spentUsd(),
    ceilingUsd: deps.meter.ceilingUsd,
    overrides,
    truncated: gates.truncated,
  };
  if (validation.outcome === 'abandoned') return { ...base, status: 'abandoned', commit: null };
  if (findings.length === 0 && validation.repairs === 0 && validation.outcome === 'ready') {
    return { ...base, status: 'nothing-to-fix', commit: null };
  }
  if (deps.dryRun) return { ...base, status: 'dry-run', commit: null };
  const today = toIsoDateInZone(now, deps.config.site.timezone);
  const published = await publishPassage(
    {
      passage: validation.passage,
      dates: deps.repo.datesForPassage(key).filter((date) => date >= today),
      costUsd: validation.passage.provenance.costUsd,
    },
    { github: deps.github, config: deps.config, base: pr.base },
  );
  return { ...base, status: published.commit === null ? 'unchanged' : 'pushed', commit: published.commit };
}

const STATUS_TEXT: Readonly<Record<FixupStatus, string>> = {
  pushed: 'pushed a fix-up commit',
  unchanged: 'the repaired file is what the PR already has; nothing pushed',
  'nothing-to-fix': 'no verifier finding to fix and gates 1–3 pass; nothing pushed',
  abandoned: 'the repairs did not pass the gates; nothing pushed',
  'dry-run': 'repaired (dry run: nothing pushed)',
};

/** What `research fixup` prints. */
export function formatFixupReport(report: FixupReport): string {
  const lines = [
    `Fix-up of PR #${String(report.pr.number)} (${report.key}) from the ${report.source}:`,
    ...report.overrides.map((text) => `Skipped check ${text}`),
    ...(report.truncated
      ? [
          'Warning: the gates comment left findings out for its size, so the repair saw only part of them. ' +
            "Download the run's gates-report artifact (gh run download <run id> -n gates-report) and pass --report gates.json.",
        ]
      : []),
    `${String(report.findings.length)} verifier finding(s) handed to the repair loop`,
    ...report.findings.map(
      (item) => `  ${item.ruleId} ${item.claimId ?? (item.pointer === '' ? 'file' : item.pointer)}: ${item.message}`,
    ),
    '',
    formatValidationReport({
      results: [report.validation],
      ready: [],
      readyWithDrops: [],
      abandoned: [],
      repairPromptVersion: REPAIR_PROMPT_VERSION,
    }).replace(/^[^\n]*\n/u, ''),
    '',
    `Result: ${STATUS_TEXT[report.status]}` +
      (report.commit === null ? '' : ` (${report.commit.sha.slice(0, 12)} on ${report.pr.head}, ${report.pr.url})`),
    `Spent $${report.spentUsd.toFixed(2)} of the $${report.ceilingUsd.toFixed(2)} run budget.`,
  ];
  return lines.join('\n');
}
