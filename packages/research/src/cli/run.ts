/**
 * `research run`: plan → research → pre-validate → publish, then a summary row per passage.
 *
 * - The plan is filtered first: a passage whose research PR a person closed is never researched
 *   again (publishing would refuse it after the money was spent). Keys with an open PR, including
 *   an approved one, are already skipped by the planner, so reviewer edits are never replaced.
 * - Research writes its raw drafts under `.cache/research/<run id>/` (git-ignored), never into the
 *   checkout; what lands is the validated file, committed through the GitHub API by publishing.
 * - A dry run researches and validates but publishes nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import type { Corpus } from '@lectio/corpus';
import type { Clock, CostMeter, GitHubClient, LlmClient, LlmFamily, ProviderSet } from '@lectio/providers';

import { loadPromptTemplate } from '../agent/prompt.ts';
import type { PromptTemplate } from '../agent/prompt.ts';
import { createRunId, researchRun } from '../agent/research.ts';
import type { PassageResult, ResearchDeps, ResearchRunResult } from '../agent/research.ts';
import type { PlanArgs } from '../plan/args.ts';
import { plan, researchBranch } from '../plan/plan.ts';
import type { Plan, WorkItem } from '../plan/plan.ts';
import { publishAll } from '../publish/publish.ts';
import type { PublishItem, PublishOutcome } from '../publish/publish.ts';
import { draftFromResult, preValidateRun } from '../validate/validate.ts';
import type { Draft, ValidationResult, ValidationRunReport } from '../validate/validate.ts';

export interface RunDeps {
  readonly config: LectioConfig;
  /** Repository root: the gates read the corpus and the licence guard index under it. */
  readonly repoRoot: string;
  readonly repo: ContentRepo;
  readonly corpus: Corpus;
  readonly github: GitHubClient;
  readonly llm: (meter: CostMeter) => LlmClient;
  /** The generator's family, for drafts that only kept the raw model output. */
  readonly family: LlmFamily;
  /** The gates' providers (the evidence and licence gates use its fetcher). */
  readonly providers: ProviderSet;
  readonly clock: Clock;
  /** The run meter; its ceiling is the run budget. */
  readonly meter: CostMeter;
  readonly dryRun: boolean;
  /** Where research writes raw drafts. Default `<repoRoot>/.cache/research/<run id>`. */
  readonly draftsDir?: string;
  /** Base-branch text of a repository path (`null` for a new passage). Default: the file in the checkout. */
  readonly readBase?: (path: string) => string | null;
  readonly prompt?: PromptTemplate;
  readonly writeFile?: ResearchDeps['writeFile'];
  readonly format?: ResearchDeps['format'];
  /** Base branch of new PRs. Default: the repository's default branch. */
  readonly base?: string;
}

/** A planned passage left out because a person closed its research PR. */
export interface ClosedSkip {
  readonly key: string;
  readonly pr: number;
}

/** One line of the end-of-run table. */
export interface SummaryRow {
  readonly key: string;
  /** What research did: `written`, `failed`, `over-budget`, `not-started` or `closed-pr`. */
  readonly research: PassageResult['status'] | 'not-started' | 'closed-pr';
  /** The pre-validation outcome, when the passage got that far. */
  readonly validation?: ValidationResult['outcome'];
  /** Research plus repairs, in USD. */
  readonly costUsd: number;
  /** The PR URL, `dry run`, or why nothing was published. */
  readonly pr: string;
  /** True when the passage needs the owner's attention (failure, abandonment, refusal). */
  readonly problem: boolean;
}

export interface RunReport {
  readonly runId: string;
  readonly plan: Plan;
  readonly closed: readonly ClosedSkip[];
  readonly research: ResearchRunResult;
  readonly validation: ValidationRunReport;
  readonly published: readonly PublishOutcome[];
  readonly dryRun: boolean;
  readonly ceilingUsd: number;
  readonly spentUsd: number;
  readonly rows: readonly SummaryRow[];
}

/** The checkout's own copy of a repository path, or `null`. */
export function checkoutReader(root: string): (path: string) => string | null {
  return (path) => {
    const absolute = join(root, path);
    return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  };
}

/** Plans the window with the run budget as the ceiling (`now` from the clock). */
export function planWindow(
  args: PlanArgs,
  deps: Pick<RunDeps, 'repo' | 'github' | 'config' | 'clock'>,
  perRunUsd: number,
): Promise<Plan> {
  return plan({
    from: args.from,
    days: args.days,
    repo: deps.repo,
    github: deps.github,
    config: deps.config,
    now: deps.clock.now(),
    perRunUsd,
    ...(args.only === undefined ? {} : { only: args.only }),
    ...(args.max === undefined ? {} : { max: args.max }),
  });
}

/** Planned items whose research PR a person closed (with no open PR on the branch). */
export async function closedKeys(
  items: readonly WorkItem[],
  github: Pick<GitHubClient, 'listPrs'>,
): Promise<ClosedSkip[]> {
  if (items.length === 0) return [];
  const prs = (await github.listPrs({ state: 'all' })).filter((pr) => !pr.fork);
  const closed: ClosedSkip[] = [];
  for (const item of items) {
    const branch = researchBranch(item.key);
    const mine = prs.filter((pr) => pr.head === branch);
    const last = mine.findLast((pr) => pr.state === 'closed');
    if (last !== undefined && !mine.some((pr) => pr.state === 'open')) closed.push({ key: item.key, pr: last.number });
  }
  return closed;
}

function publishNote(outcome: PublishOutcome | undefined, dryRun: boolean): { pr: string; problem: boolean } {
  if (outcome === undefined) return { pr: dryRun ? 'dry run' : '-', problem: false };
  if (outcome.ok) return { pr: outcome.pr.url, problem: false };
  return { pr: `not published: ${outcome.error.message}`, problem: !outcome.skipped };
}

function rowsOf(
  items: readonly WorkItem[],
  closed: readonly ClosedSkip[],
  research: ResearchRunResult,
  validation: ValidationRunReport,
  published: readonly PublishOutcome[],
  dryRun: boolean,
): SummaryRow[] {
  return items.map((item): SummaryRow => {
    const skip = closed.find((entry) => entry.key === item.key);
    if (skip !== undefined) {
      return { key: item.key, research: 'closed-pr', costUsd: 0, pr: `#${String(skip.pr)} closed`, problem: false };
    }
    const result = research.results.find((entry) => entry.key === item.key);
    if (result === undefined) {
      return { key: item.key, research: 'not-started', costUsd: 0, pr: 'run budget spent', problem: true };
    }
    const checked = validation.results.find((entry) => entry.key === item.key);
    const costUsd = result.costUsd + (checked?.repairCostUsd ?? 0);
    if (checked === undefined) {
      const why = result.status === 'over-budget' ? `over budget (${result.meter})` : 'nothing to repair';
      return { key: item.key, research: result.status, costUsd, pr: why, problem: true };
    }
    if (checked.outcome === 'abandoned') {
      return {
        key: item.key,
        research: result.status,
        validation: checked.outcome,
        costUsd,
        pr: 'abandoned',
        problem: true,
      };
    }
    const note = publishNote(
      published.find((entry) => entry.key === item.key),
      dryRun,
    );
    return { key: item.key, research: result.status, validation: checked.outcome, costUsd, ...note };
  });
}

/** Runs `research run` for a planned window. Unexpected (programming) errors are rethrown. */
export async function runResearch(args: PlanArgs, deps: RunDeps): Promise<RunReport> {
  const now = deps.clock.now();
  const runId = createRunId(now);
  const planned = await planWindow(args, deps, deps.meter.ceilingUsd);
  const closed = await closedKeys(planned.items, deps.github);
  const items = planned.items.filter((item) => !closed.some((entry) => entry.key === item.key));

  const prompt = deps.prompt ?? (await loadPromptTemplate());
  const research = await researchRun(items, {
    llm: deps.llm,
    meter: deps.meter,
    corpus: deps.corpus,
    repo: deps.repo,
    config: deps.config,
    clock: deps.clock,
    contentRoot: deps.draftsDir ?? join(deps.repoRoot, '.cache', 'research', runId),
    runId,
    prompt,
    ...(deps.writeFile === undefined ? {} : { writeFile: deps.writeFile }),
    ...(deps.format === undefined ? {} : { format: deps.format }),
  });

  const meta = {
    locale: deps.config.site.defaultLocale,
    runId,
    models: [deps.config.research.models.generator.model],
    family: deps.family,
    promptVersion: prompt.version,
    createdAt: now.toISOString(),
  };
  const drafts = research.results.flatMap((result): Draft[] => {
    if (result.status === 'over-budget') return [];
    const item = items.find((entry) => entry.key === result.key) as WorkItem;
    const draft = draftFromResult(result, item, meta);
    return draft === undefined ? [] : [draft];
  });
  const validation = await preValidateRun(drafts, {
    llm: deps.llm,
    meter: deps.meter,
    config: deps.config,
    providers: deps.providers,
    root: deps.repoRoot,
    repo: deps.repo,
    readBase: deps.readBase ?? checkoutReader(deps.repoRoot),
    ...(deps.format === undefined ? {} : { format: deps.format }),
  });

  const ready = validation.results.flatMap((result): PublishItem[] => {
    if (result.outcome === 'abandoned') return [];
    const item = items.find((entry) => entry.key === result.key) as WorkItem;
    return [{ passage: result.passage, dates: item.dates, costUsd: result.passage.provenance.costUsd }];
  });
  const published = deps.dryRun
    ? []
    : await publishAll(ready, {
        github: deps.github,
        config: deps.config,
        ...(deps.base === undefined ? {} : { base: deps.base }),
      });

  return {
    runId,
    plan: planned,
    closed,
    research,
    validation,
    published,
    dryRun: deps.dryRun,
    ceilingUsd: deps.meter.ceilingUsd,
    spentUsd: deps.meter.spentUsd(),
    rows: rowsOf(planned.items, closed, research, validation, published, deps.dryRun),
  };
}
