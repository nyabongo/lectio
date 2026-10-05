/**
 * The translation planner: which English passages of a calendar window to translate into one
 * locale. A passage is planned when its English file exists (and is approved, unless pending
 * passages are included) and its translation is missing or stale (`sourceSha256` no longer matches
 * the English text). It skips passages whose translation PR is already open, and stops at `max`.
 *
 * It reads the content repository and lists PRs; it never writes anything or calls an LLM.
 */
import { isApproved } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import type { GitHubClient } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';
import { translatableSha256 } from '@lectio/schema/translated-passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';
import { addDays, dateRange } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

/** Branch prefix of translation PRs: one branch (and PR) per locale and passage, `translate/<locale>/<key>`. */
export const TRANSLATE_BRANCH_PREFIX = 'translate/';

/** The translation branch for a locale and passage key. */
export function translationBranch(locale: string, key: string): string {
  return `${TRANSLATE_BRANCH_PREFIX}${locale}/${key}`;
}

export interface TranslationItem {
  readonly key: string;
  readonly english: Passage;
  /** `new` when no translation exists, `stale` when the English text changed since it was made. */
  readonly reason: 'new' | 'stale';
  /** Dates in the window (or from `from` on, for `only`) the passage is read on, ascending. */
  readonly dates: readonly IsoDate[];
}

/**
 * Why a scheduled passage is not planned: `no-english` (no English file yet: research it first),
 * `english-pending` (the English file is not approved), `fresh` (its translation is up to date),
 * `open-pr` (its translation PR is open) or `max`.
 */
export type TranslationSkipReason = 'no-english' | 'english-pending' | 'fresh' | 'open-pr' | 'max';

export interface TranslationSkipped {
  readonly key: string;
  readonly reason: TranslationSkipReason;
  readonly dates: readonly IsoDate[];
  /** For `open-pr`: the PR number. */
  readonly pr?: number;
}

export interface TranslationPlan {
  readonly locale: string;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly items: readonly TranslationItem[];
  readonly skipped: readonly TranslationSkipped[];
}

export interface TranslationPlanInput {
  readonly locale: string;
  readonly from: IsoDate;
  readonly days: number;
  readonly repo: Pick<ContentRepo, 'calendarYear' | 'passage' | 'datesForPassage'>;
  /** The current translation of `key` into `locale`, or `null` when there is none (or it is unreadable). */
  readonly readTranslation: (locale: string, key: string) => TranslatedPassage | null;
  readonly github: Pick<GitHubClient, 'listPrs'>;
  readonly only?: string;
  readonly max?: number;
  readonly includePending?: boolean;
}

/** Passage keys read in `dates`, in calendar order, each with its dates. */
function scheduled(repo: TranslationPlanInput['repo'], dates: readonly IsoDate[]): Map<string, IsoDate[]> {
  const keys = new Map<string, IsoDate[]>();
  const wanted = new Set(dates);
  for (const year of new Set(dates.map((date) => Number(date.slice(0, 4))))) {
    const days = (repo.calendarYear(year)?.days ?? []).filter((day) => wanted.has(day.date));
    for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
      for (const mass of day.masses) {
        for (const { key } of mass.readings) {
          const list = keys.get(key) ?? [];
          if (list.at(-1) !== day.date) list.push(day.date);
          keys.set(key, list);
        }
      }
    }
  }
  return keys;
}

/** Plans one translation run. See the module comment for the rules. */
export async function planTranslations(input: TranslationPlanInput): Promise<TranslationPlan> {
  const { locale, from, days, repo, only } = input;
  const to = addDays(from, days - 1);
  let keys = scheduled(repo, dateRange(from, to));
  if (only !== undefined) {
    const inWindow = keys.get(only);
    keys = new Map([[only, inWindow ?? repo.datesForPassage(only).filter((date) => date >= from)]]);
  }
  const open = (await input.github.listPrs({ state: 'open' })).filter((pr) => !pr.fork);
  const prByBranch = new Map(open.map((pr) => [pr.head, pr.number]));

  const items: TranslationItem[] = [];
  const skipped: TranslationSkipped[] = [];
  for (const [key, dates] of keys) {
    const english = repo.passage(key);
    const pr = prByBranch.get(translationBranch(locale, key));
    const current = english === null ? null : input.readTranslation(locale, key);
    const fresh = english !== null && current !== null && current.sourceSha256 === translatableSha256(english);
    if (english === null) skipped.push({ key, reason: 'no-english', dates });
    else if (!isApproved(english) && input.includePending !== true) {
      skipped.push({ key, reason: 'english-pending', dates });
    } else if (fresh) skipped.push({ key, reason: 'fresh', dates });
    else if (pr !== undefined) skipped.push({ key, reason: 'open-pr', dates, pr });
    else if (input.max !== undefined && items.length >= input.max) skipped.push({ key, reason: 'max', dates });
    else items.push({ key, english, reason: current === null ? 'new' : 'stale', dates });
  }
  return { locale, from, to, items, skipped };
}
