/**
 * The logic behind `npm run research` (index.ts only wires in process state): parse the command,
 * set the budget, compose the providers, run the subcommand and print its report.
 *
 * Exit codes: 0 done, 1 something needs the owner's attention (a refusal, a missing key, an
 * abandoned or failed passage), 2 a bad command line.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRepoRoot, loadConfig } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import { openCorpus } from '@lectio/corpus';
import type { Corpus } from '@lectio/corpus';
import { systemClock } from '@lectio/providers';
import type { Clock, GitHubClient } from '@lectio/providers';

import { createRunId } from '../agent/research.ts';
import { UsageError } from '../plan/args.ts';
import { formatPlan } from '../plan/format.ts';
import { formatTranslateReport, fsReadTranslation, runTranslate } from '../translate/run.ts';
import { USAGE, parseCommand } from './args.ts';
import type { Command, CommonArgs } from './args.ts';
import { BudgetRefusedError, planCeilingUsd, runCeilingUsd } from './budget.ts';
import { FixupRefusedError, formatFixupReport, runFixup } from './fixup.ts';
import type { PrFiles } from './fixup.ts';
import { GateOutputError } from './gates-comment.ts';
import { gitPrFiles } from './git.ts';
import { ProviderSetupError, composeProviders } from './providers.ts';
import type { ComposeOptions, Toolkit } from './providers.ts';
import { closedKeys, planWindow, runResearch } from './run.ts';
import { formatRunReport } from './summary.ts';

export interface CliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface CliContext {
  readonly repoRoot: string;
  readonly config: LectioConfig;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock?: Clock;
  /** Default {@link composeProviders}. */
  readonly compose?: (options: ComposeOptions) => Promise<Toolkit>;
  /** Default `openRepo(<repoRoot>/<content.root>)`. */
  readonly repo?: ContentRepo;
  /** Default `openCorpus(<repoRoot>/corpus)`. */
  readonly corpus?: Corpus;
  /** How fix-up reads a PR's files. Default git in `repoRoot`. */
  readonly files?: PrFiles;
  readonly readFile?: (path: string) => string;
  /** Formats JSON like the repository's Prettier check (injected in tests). */
  readonly format?: (json: string, path: string) => Promise<string>;
}

/**
 * The context of a CLI run: the repository root above `INIT_CWD` (npm sets it to where the command
 * was typed), else `cwd`, and the config `loadConfig` finds from there.
 */
export function processContext(env: NodeJS.ProcessEnv, cwd: string): CliContext {
  const start = env['INIT_CWD'] ?? cwd;
  return { repoRoot: findRepoRoot(start), config: loadConfig(undefined, { env, cwd: start }), env };
}

/** A dry run's view of GitHub: reads pass through, every write is refused. */
export class DryRunError extends Error {
  override readonly name = 'DryRunError';
}

const GITHUB_WRITES: ReadonlySet<string> = new Set([
  'createBranch',
  'commitFiles',
  'openOrUpdatePr',
  'addLabels',
  'removeLabels',
  'upsertComment',
  'enableAutoMerge',
  'mergePr',
  'dispatchWorkflow',
  'upsertIssue',
]);

/** `github` with every write refused by a {@link DryRunError}. */
export function dryRunGitHub(github: GitHubClient): GitHubClient {
  return new Proxy(github, {
    get(target, property) {
      if (typeof property === 'string' && GITHUB_WRITES.has(property)) {
        return () => Promise.reject(new DryRunError(`dry run: ${property} was not sent to GitHub`));
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

type Runnable = Exclude<Command, { readonly kind: 'help' }>;

async function toolkitFor(command: Runnable, context: CliContext, ceilingUsd: number): Promise<Toolkit> {
  return (context.compose ?? composeProviders)({
    mode: command.common.provider,
    config: context.config,
    env: context.env,
    ceilingUsd,
    llm: command.kind !== 'plan',
    ...(context.clock === undefined ? {} : { clock: context.clock }),
  });
}

function sources(context: CliContext): { repo: ContentRepo; corpus: Corpus; contentRoot: string } {
  const contentRoot = join(context.repoRoot, context.config.content.root);
  return {
    repo: context.repo ?? openRepo(contentRoot),
    corpus: context.corpus ?? openCorpus(join(context.repoRoot, 'corpus')),
    contentRoot,
  };
}

function note(common: CommonArgs, io: CliIo): void {
  if (common.dryRunForced) io.out('--provider fake: dry run, nothing is published.');
  else if (common.dryRun) io.out('Dry run: nothing is published.');
}

async function execute(command: Runnable, context: CliContext, io: CliIo): Promise<number> {
  const { config } = context;
  note(command.common, io);
  const format = context.format === undefined ? {} : { format: context.format };
  if (command.kind === 'plan') {
    const kit = await toolkitFor(command, context, planCeilingUsd(command.common, config));
    const { repo } = sources(context);
    const planned = await planWindow(command.window, { ...kit, repo, config }, kit.meter.ceilingUsd);
    io.out(formatPlan(planned).trimEnd());
    for (const entry of await closedKeys(planned.items, kit.github)) {
      io.out(`Will skip ${entry.key}: a person closed PR #${String(entry.pr)}`);
    }
    return 0;
  }

  const kit = await toolkitFor(command, context, runCeilingUsd(command.common, config));
  const { repo, corpus, contentRoot } = sources(context);
  const dryRun = command.common.dryRun;
  if (command.kind === 'run') {
    const report = await runResearch(command.window, {
      ...kit,
      ...format,
      config,
      repoRoot: context.repoRoot,
      repo,
      corpus,
      dryRun,
    });
    io.out(formatRunReport(report));
    return report.rows.some((row) => row.problem) ? 1 : 0;
  }
  if (command.kind === 'fixup') {
    const report = await runFixup(
      { pr: command.pr, force: command.force, ...(command.report === undefined ? {} : { report: command.report }) },
      {
        ...kit,
        ...format,
        config,
        repoRoot: context.repoRoot,
        repo,
        dryRun,
        files: context.files ?? gitPrFiles(context.repoRoot),
        readReport: context.readFile ?? ((path) => readFileSync(path, 'utf8')),
      },
    );
    io.out(formatFixupReport(report));
    return report.status === 'abandoned' ? 1 : 0;
  }
  const report = await runTranslate(command.argv, {
    ...format,
    config,
    clock: kit.clock,
    repo,
    github: dryRun ? dryRunGitHub(kit.github) : kit.github,
    llm: kit.llm,
    meter: kit.meter,
    contentRoot: join(
      context.repoRoot,
      '.cache',
      'research',
      createRunId(kit.clock.now()).replace(/^research-/u, 'translate-'),
    ),
    readTranslation: fsReadTranslation(contentRoot),
  });
  io.out(formatTranslateReport(report));
  const failed =
    report.results.some((result) => result.status !== 'written') ||
    report.published.some((outcome) => !outcome.ok && !(outcome.error instanceof DryRunError)) ||
    report.notStarted.length > 0;
  return failed ? 1 : 0;
}

/** Runs `npm run research` with `argv`; returns the exit code. */
export async function main(argv: readonly string[], context: CliContext, io: CliIo): Promise<number> {
  try {
    const command = parseCommand(argv, { config: context.config, now: (context.clock ?? systemClock).now() });
    if (command.kind === 'help') {
      io.out(USAGE);
      return 0;
    }
    return await execute(command, context, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      return 2;
    }
    if (
      error instanceof BudgetRefusedError ||
      error instanceof ProviderSetupError ||
      error instanceof FixupRefusedError ||
      error instanceof GateOutputError
    ) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}
