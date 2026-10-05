/**
 * `lectio-gates ci <command>`: the steps of content-gates.yml (L-031). Each job checks out main for
 * tooling, runs `npm ci` there and calls one of these; the PR head is only data in `pr-head/`.
 *
 *     lectio-gates ci resolve                         which PR and head (trusted workflow); writes run, pr, …
 *     lectio-gates ci changes --root pr-head --base <ref> [--head <sha>]   writes relevant=true|false;
 *                                                     exits 1 for a changed symlink or submodule
 *     lectio-gates ci merge-rule --pr <n> --head-sha <sha> --base <ref> --root pr-head
 *                                [--results <gates.json>]… [--phase decide|approve|dispatch]
 *                                [--approval-commit <sha>]   (phase dispatch)
 *                                                     writes decision, manual-merge, write, approval-artifact
 *     lectio-gates ci skip --head-sha <sha> --reason <text>   a green merge-rule check (nothing relevant)
 *     lectio-gates ci merge --pr <n> --sha <sha>
 *
 * Step outputs go to `$GITHUB_OUTPUT` and the job summary to `$GITHUB_STEP_SUMMARY` (printed when
 * unset). The GitHub client is provider-gh acting as `github-actions[bot]` with the required checks
 * from `.github/required-checks/` of the tooling checkout. Exit codes: 0 green, 1 red, 2 usage.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { ParseArgsOptionsConfig } from 'node:util';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { GhGitHubClient } from '@lectio/provider-gh';
import type { GitHubClient } from '@lectio/providers';
import { validateGateResult } from '@lectio/schema/gate-result';

import type { GatesCliOptions } from '../cli/run.ts';
import type { GateResult } from '../core/result.ts';
import { changedPaths } from '../merge-rule/index.ts';
import type { FormatJson } from '../review/approve.ts';
import { toolPrettierJson } from './approval-commit.ts';
import { gitCheckout } from './checkout.ts';
import type { PrCheckout } from './checkout.ts';
import { ACTIONS_BOT } from './facts.ts';
import { runMergeJob } from './merge-job.ts';
import { MERGE_RULE_CHECK, runMergeRuleJob } from './merge-rule-job.ts';
import { readRequiredChecks } from './registry.ts';
import type { RequiredChecksRegistry } from './registry.ts';
import { relevantFiles, resolveTarget } from './target.ts';

export const CI_USAGE = [
  'usage: lectio-gates ci resolve',
  '       lectio-gates ci changes --root <dir> --base <ref> [--head <ref>]',
  '       lectio-gates ci merge-rule --pr <n> --head-sha <sha> --base <ref> --root <dir> [--results <file>]…',
  '                                  [--job-result <file>=<result>]…',
  '                                  [--phase decide|approve|dispatch] [--approval-commit <sha>]',
  '       lectio-gates ci skip --head-sha <sha> --reason <text>',
  '       lectio-gates ci merge --pr <n> --sha <sha>',
].join('\n');

export interface CiCliOptions extends GatesCliOptions {
  /** Default: provider-gh as github-actions[bot] (`GH_TOKEN`), with the registry's required checks. */
  readonly github?: GitHubClient;
  /** Default: the git worktree at `--root`. */
  readonly checkout?: PrCheckout;
  /** Default: `.github/required-checks/` of the tooling checkout. */
  readonly registry?: RequiredChecksRegistry;
  readonly format?: FormatJson;
  readonly now?: () => Date;
  readonly appendFile?: (path: string, text: string) => void;
}

class CiUsageError extends Error {}

function parse<T extends ParseArgsOptionsConfig>(args: readonly string[], options: T) {
  try {
    return parseArgs({ args: [...args], options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new CiUsageError((error as Error).message);
  }
}

function required(values: Record<string, unknown>, name: string): string {
  const value = values[name];
  if (typeof value !== 'string' || value === '') throw new CiUsageError(`--${name} is required`);
  return value;
}

function prNumber(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new CiUsageError(`--pr must be a PR number (got "${value}")`);
  return Number(value);
}

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
function sha(name: string, value: string): string {
  if (!SHA.test(value)) throw new CiUsageError(`--${name} must be a full commit sha (got "${value}")`);
  return value;
}

/** The record the approval artifact carries (`--phase decide`), relative to the working directory. */
export const APPROVAL_RECORD = 'out/approval/approval.json';

/** The full gate report of the trusted run (uploaded as the `gates-report` artifact, for `--report`). */
export const REPORT_FILE = 'out/report/gates.json';

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

interface Io {
  readonly toolRoot: string;
  /** `DEFAULT_BRANCH` (the workflow passes `github.event.repository.default_branch`), else `main`. */
  readonly defaultBranch: () => string;
  readonly config: () => LectioConfig;
  readonly registry: () => RequiredChecksRegistry;
  readonly github: () => GitHubClient;
  readonly output: (values: Readonly<Record<string, string | number | boolean>>) => void;
  readonly summary: (text: string) => void;
  readonly path: (file: string) => string;
}

function io(options: CiCliOptions): Io {
  const { env } = options;
  const toolRoot = findRepoRoot(options.cwd);
  const append = options.appendFile ?? ((path: string, text: string) => appendFileSync(path, text, 'utf8'));
  let registry: RequiredChecksRegistry | undefined;
  const getRegistry = (): RequiredChecksRegistry => (registry ??= options.registry ?? readRequiredChecks(toolRoot));
  let github: GitHubClient | undefined;
  return {
    toolRoot,
    defaultBranch: () => env['DEFAULT_BRANCH'] || 'main',
    config: () => options.config ?? loadConfig(undefined, { cwd: options.cwd, env }),
    registry: getRegistry,
    github: () =>
      (github ??=
        options.github ??
        new GhGitHubClient({
          viewer: ACTIONS_BOT,
          // The registry's checks plus merge-rule, which the trusted workflow publishes on the head.
          requiredChecks: [...getRegistry().checks, MERGE_RULE_CHECK],
          env,
          ...(env['GITHUB_REPOSITORY'] ? { repo: env['GITHUB_REPOSITORY'] } : {}),
        })),
    output(values) {
      const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/[\r\n]+/g, ' ')}`);
      for (const line of lines) options.log(`output ${line}`);
      const file = env['GITHUB_OUTPUT'];
      if (file) append(file, `${lines.join('\n')}\n`);
    },
    summary(text) {
      const file = env['GITHUB_STEP_SUMMARY'];
      if (file) append(file, `${text}\n`);
      else options.log(text);
    },
    path: (file) => resolve(options.cwd, file),
  };
}

async function resolveCommand(args: readonly string[], options: CiCliOptions, ctx: Io): Promise<number> {
  parse(args, {});
  const eventName = options.env['GITHUB_EVENT_NAME'] ?? '';
  const eventPath = options.env['GITHUB_EVENT_PATH'];
  if (!eventName || !eventPath) throw new CiUsageError('resolve needs GITHUB_EVENT_NAME and GITHUB_EVENT_PATH');
  const read = options.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  const payload: unknown = JSON.parse(read(eventPath));
  const onDefaultBranch = options.env['GITHUB_REF'] === `refs/heads/${ctx.defaultBranch()}`;
  const target = await resolveTarget(eventName, payload, {
    github: ctx.github(),
    config: ctx.config(),
    onDefaultBranch,
  });
  options.log(`resolve: ${target.reason}`);
  ctx.output({
    run: target.run,
    reason: target.reason,
    pr: target.prNumber,
    'head-sha': target.headSha,
    base: target.base,
    'base-ref': target.baseRef,
    fork: target.fork,
    verifiers: target.verifiers,
    'approval-head': target.approvalHead,
  });
  return 0;
}

async function changesCommand(args: readonly string[], options: CiCliOptions, ctx: Io): Promise<number> {
  const values = parse(args, { root: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' } });
  const root = ctx.path(required(values, 'root'));
  const base = required(values, 'base');
  const head = values.head ?? 'HEAD';
  const checkout = options.checkout ?? gitCheckout(root, head, options.gitExec);
  const paths = changedPaths(checkout.changedFiles(base, head));
  const unsafe = checkout.nonRegular(base, head);
  if (unsafe.length > 0) {
    // A symbolic link could point anywhere on the runner: refuse it before any gate reads the tree.
    for (const path of unsafe)
      options.error(`::error file=${path}::${path} is not a regular file (symbolic link or submodule)`);
    ctx.summary(
      `Refused: ${unsafe.join(', ')} ${unsafe.length === 1 ? 'is not a regular file' : 'are not regular files'}.`,
    );
    ctx.output({ relevant: true });
    return 1;
  }
  const relevant = relevantFiles(paths);
  options.log(`changes: ${String(paths.length)} changed, ${String(relevant.length)} relevant`);
  for (const path of paths) options.log(`  ${relevant.includes(path) ? '*' : ' '} ${path}`);
  if (relevant.length === 0)
    ctx.summary('Nothing relevant to the content gates changed (passages/, calendar/, corpus/, config/); skipping.');
  ctx.output({ relevant: relevant.length > 0 });
  return 0;
}

interface ReadReports {
  readonly results: GateResult[];
  readonly offline: boolean;
}

/**
 * `--job-result <file>=<result>`: the result of the job that writes `<file>` (`success`, `failure`,
 * `skipped`, …, as `needs.<job>.result` gives it), so a missing report can be told apart: a job that
 * did not run, or a job that ran but whose artifact is not where this step reads it.
 */
function jobResults(values: readonly string[]): ReadonlyMap<string, string> {
  return new Map(
    values.map((value) => {
      const at = value.lastIndexOf('=');
      if (at <= 0) throw new CiUsageError(`--job-result must be <file>=<result> (got "${value}")`);
      return [value.slice(0, at), value.slice(at + 1)] as const;
    }),
  );
}

function readReports(
  files: readonly string[],
  ran: ReadonlyMap<string, string>,
  options: CiCliOptions,
  ctx: Io,
): ReadReports {
  const read = options.readFile ?? ((file: string) => readFileSync(file, 'utf8'));
  const exists = options.readFile === undefined ? existsSync : () => true;
  const results: GateResult[] = [];
  let offline = false;
  for (const file of files) {
    const path = ctx.path(file);
    if (!exists(path)) {
      const result = ran.get(file) ?? '';
      if (result === '' || result === 'skipped') options.log(`merge-rule: ${file} is missing: that job did not run`);
      else
        options.error(
          `::warning::merge-rule: ${file} is missing although its job ended ${result}: its artifact was not found at ${file}`,
        );
      continue;
    }
    const report = JSON.parse(read(path)) as { results?: unknown; fetcher?: unknown } | null;
    if (!Array.isArray(report?.results)) throw new CiUsageError(`${file}: expected a gate report with "results"`);
    for (const [index, result] of report.results.entries()) {
      if (!validateGateResult(result)) throw new CiUsageError(`${file}: results/${String(index)} is not a gate result`);
      results.push(result);
    }
    if (report.fetcher === 'offline-fake') offline = true;
  }
  return { results, offline };
}

async function mergeRuleCommand(args: readonly string[], options: CiCliOptions, ctx: Io): Promise<number> {
  const values = parse(args, {
    pr: { type: 'string' },
    'head-sha': { type: 'string' },
    base: { type: 'string' },
    root: { type: 'string' },
    results: { type: 'string', multiple: true },
    'job-result': { type: 'string', multiple: true },
    phase: { type: 'string', default: 'decide' },
    'approval-commit': { type: 'string' },
  });
  const phase = values.phase;
  if (phase !== 'decide' && phase !== 'approve' && phase !== 'dispatch')
    throw new CiUsageError(`--phase must be decide, approve or dispatch (got "${phase}")`);
  const approvalCommit = phase === 'dispatch' ? sha('approval-commit', required(values, 'approval-commit')) : undefined;
  const number = prNumber(required(values, 'pr'));
  const headSha = sha('head-sha', required(values, 'head-sha'));
  const base = required(values, 'base');
  const root = ctx.path(required(values, 'root'));
  const runId = options.env['GITHUB_RUN_ID'] ?? '';
  if (!/^[1-9][0-9]*$/.test(runId)) throw new CiUsageError('merge-rule needs GITHUB_RUN_ID');
  const ran = jobResults(values['job-result'] ?? []);
  const { results, offline } = readReports(values.results ?? [], ran, options, ctx);
  const outcome = await runMergeRuleJob({
    phase,
    defaultBranch: ctx.defaultBranch(),
    github: ctx.github(),
    config: ctx.config(),
    checkout: options.checkout ?? gitCheckout(root, headSha, options.gitExec),
    registry: ctx.registry(),
    prNumber: number,
    headSha,
    base,
    runId,
    results,
    ...(approvalCommit === undefined ? {} : { approvalCommitSha: approvalCommit }),
    ...(offline ? { note: 'the deterministic gates ran with the offline fake fetcher' } : {}),
    format: options.format ?? toolPrettierJson(ctx.toolRoot),
    now: options.now ?? (() => new Date()),
    log: options.log,
  });
  ctx.summary(outcome.summary);
  if (outcome.report !== undefined)
    (options.writeFile ?? writeText)(ctx.path(REPORT_FILE), `${JSON.stringify(outcome.report, null, 2)}\n`);
  if (outcome.approvalArtifact !== undefined) {
    // Uploaded by the next workflow step, from inside this run, before `--phase dispatch`.
    const record = {
      pr: number,
      head: headSha,
      commit: outcome.approvalCommitSha,
      run: runId,
      decision: outcome.decision,
    };
    (options.writeFile ?? writeText)(ctx.path(APPROVAL_RECORD), `${JSON.stringify(record, null, 2)}\n`);
  }
  ctx.output({
    decision: outcome.decision ?? 'none',
    'manual-merge': outcome.manualMerge,
    write: outcome.write,
    'approval-artifact': outcome.approvalArtifact ?? '',
    'approval-commit': outcome.approvalCommitSha ?? '',
  });
  return outcome.exitCode;
}

async function skipCommand(args: readonly string[], options: CiCliOptions, ctx: Io): Promise<number> {
  const values = parse(args, { 'head-sha': { type: 'string' }, reason: { type: 'string' } });
  const headSha = sha('head-sha', required(values, 'head-sha'));
  const reason = required(values, 'reason');
  await ctx.github().createCheckRun({
    name: MERGE_RULE_CHECK,
    headSha,
    conclusion: 'success',
    title: 'nothing to decide',
    summary: reason,
  });
  options.log(`merge-rule: ${reason}`);
  return 0;
}

async function mergeCommand(args: readonly string[], options: CiCliOptions, ctx: Io): Promise<number> {
  const values = parse(args, { pr: { type: 'string' }, sha: { type: 'string' } });
  const outcome = await runMergeJob({
    github: ctx.github(),
    prNumber: prNumber(required(values, 'pr')),
    sha: sha('sha', required(values, 'sha')),
    log: options.log,
  });
  return outcome.exitCode;
}

const COMMANDS = {
  resolve: resolveCommand,
  changes: changesCommand,
  'merge-rule': mergeRuleCommand,
  skip: skipCommand,
  merge: mergeCommand,
} as const;

/** Runs `lectio-gates ci <command> …` and returns the exit code. */
export async function runCiCli(argv: readonly string[], options: CiCliOptions): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === undefined || !Object.hasOwn(COMMANDS, command))
      throw new CiUsageError(command === undefined ? 'missing ci command' : `unknown ci command "${command}"`);
    return await COMMANDS[command as keyof typeof COMMANDS](rest, options, io(options));
  } catch (error) {
    if (!(error instanceof CiUsageError)) throw error;
    options.error(`lectio-gates ci: ${error.message}`);
    options.error(CI_USAGE);
    return 2;
  }
}
