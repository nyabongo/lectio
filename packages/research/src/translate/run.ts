/**
 * `npm run research -- translate --locale sw --from … --days …` (L-112): plan the window's
 * passages that need a translation, translate each one with the generator model, write
 * `passages/i18n/<locale>/<key>.json`, and open one needs-review PR per translation.
 *
 * Runs locally, like research (L-201). The CLI entry point (L-038) dispatches the `translate`
 * subcommand here with the real providers; tests inject the fakes.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import type { Clock, CostMeter, GitHubClient, LlmClient } from '@lectio/providers';
import { translatedPassagePath, validateTranslatedPassage } from '@lectio/schema/translated-passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import { createRunId } from '../agent/research.ts';
import { parseTranslateArgs } from './args.ts';
import type { TranslateArgs } from './args.ts';
import { planTranslations } from './plan.ts';
import type { TranslationPlan } from './plan.ts';
import { publishTranslation } from './publish.ts';
import type { TranslationPublishOptions, TranslationPublishResult } from './publish.ts';
import { translatePassage } from './translate.ts';
import type { TranslateDeps, TranslationResult } from './translate.ts';

/** Reads `<contentRoot>/passages/i18n/<locale>/<key>.json`; `null` when it is missing, unreadable or invalid. */
export function fsReadTranslation(contentRoot: string): (locale: string, key: string) => TranslatedPassage | null {
  return (locale, key) => {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(contentRoot, translatedPassagePath(locale, key)), 'utf8'));
    } catch {
      return null;
    }
    return validateTranslatedPassage(value) ? value : null;
  };
}

export interface RunTranslateDeps {
  readonly config: Pick<LectioConfig, 'site' | 'research'>;
  readonly clock: Clock;
  readonly repo: Pick<ContentRepo, 'calendarYear' | 'passage' | 'datesForPassage'>;
  readonly github: TranslationPublishOptions['github'] & Pick<GitHubClient, 'listPrs'>;
  readonly llm: (meter: CostMeter) => LlmClient;
  /** The run's cost meter (its ceiling is the run budget). */
  readonly meter: CostMeter;
  /** Content repository root. */
  readonly contentRoot: string;
  /** Defaults to {@link fsReadTranslation} over `contentRoot`. */
  readonly readTranslation?: (locale: string, key: string) => TranslatedPassage | null;
  /** Base branch of the PRs; default the repository's default branch. */
  readonly base?: string;
  readonly writeFile?: TranslateDeps['writeFile'];
  readonly format?: TranslateDeps['format'];
}

export type TranslatePublishOutcome =
  | ({ readonly ok: true } & TranslationPublishResult)
  | { readonly ok: false; readonly key: string; readonly error: Error };

export interface TranslateRunReport {
  readonly args: TranslateArgs;
  readonly runId: string;
  readonly plan: TranslationPlan;
  readonly results: readonly TranslationResult[];
  readonly published: readonly TranslatePublishOutcome[];
  /** Planned passages never started because the run budget ran out. */
  readonly notStarted: readonly string[];
  readonly spentUsd: number;
}

/** Runs the translate subcommand with `argv` (the words after `translate`); throws `UsageError` on bad flags. */
export async function runTranslate(argv: readonly string[], deps: RunTranslateDeps): Promise<TranslateRunReport> {
  const now = deps.clock.now();
  const args = parseTranslateArgs(argv, { config: deps.config, now });
  const runId = createRunId(now).replace(/^research-/, 'translate-');
  const plan = await planTranslations({
    locale: args.locale,
    from: args.from,
    days: args.days,
    repo: deps.repo,
    readTranslation: deps.readTranslation ?? fsReadTranslation(deps.contentRoot),
    github: deps.github,
    includePending: args.includePending,
    ...(args.only === undefined ? {} : { only: args.only }),
    ...(args.max === undefined ? {} : { max: args.max }),
  });
  const translateDeps: TranslateDeps = {
    llm: deps.llm,
    meter: deps.meter,
    config: deps.config,
    clock: deps.clock,
    runId,
    locale: args.locale,
    contentRoot: deps.contentRoot,
    ...(deps.writeFile === undefined ? {} : { writeFile: deps.writeFile }),
    ...(deps.format === undefined ? {} : { format: deps.format }),
  };
  const results: TranslationResult[] = [];
  const published: TranslatePublishOutcome[] = [];
  const notStarted: string[] = [];
  for (const item of plan.items) {
    if (deps.meter.remainingUsd() <= 0) {
      notStarted.push(item.key);
      continue;
    }
    const result = await translatePassage(item.english, translateDeps);
    results.push(result);
    if (result.status !== 'written') continue;
    try {
      const outcome = await publishTranslation(
        { translation: result.translation, dates: item.dates },
        { github: deps.github, ...(deps.base === undefined ? {} : { base: deps.base }) },
      );
      published.push({ ok: true, ...outcome });
    } catch (error) {
      published.push({ ok: false, key: item.key, error: error instanceof Error ? error : new Error(String(error)) });
    }
  }
  return { args, runId, plan, results, published, notStarted, spentUsd: deps.meter.spentUsd() };
}

/** A plain-text summary of a run, one line per passage, for the CLI. */
export function formatTranslateReport(report: TranslateRunReport): string {
  const { plan } = report;
  const lines = [
    `translate ${plan.locale}: ${plan.from} to ${plan.to} (run ${report.runId})`,
    `planned ${String(plan.items.length)}, skipped ${String(plan.skipped.length)}`,
  ];
  for (const skipped of plan.skipped) {
    lines.push(
      `  skip ${skipped.key}: ${skipped.reason}${skipped.pr === undefined ? '' : ` (#${String(skipped.pr)})`}`,
    );
  }
  for (const result of report.results) {
    if (result.status === 'written') lines.push(`  wrote ${result.path}`);
    else if (result.status === 'over-budget') lines.push(`  over budget ${result.key} (${result.meter})`);
    else lines.push(`  failed ${result.key}: ${result.error}`, ...result.issues.map((issue) => `    ${issue}`));
  }
  for (const outcome of report.published) {
    if (outcome.ok) {
      lines.push(
        `  ${outcome.created ? 'opened' : 'updated'} PR #${String(outcome.pr.number)} ${outcome.pr.url} (needs review)`,
      );
    } else lines.push(`  not published ${outcome.key}: ${outcome.error.message}`);
  }
  for (const key of report.notStarted) lines.push(`  not started ${key}: run budget spent`);
  lines.push(`spent $${report.spentUsd.toFixed(2)}`);
  return lines.join('\n');
}
