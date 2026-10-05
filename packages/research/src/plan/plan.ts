/**
 * The research planner (steps 1–2 of a run): list the passages the calendar needs in a date
 * window, drop the ones the repository already has or that already have an open research PR,
 * and cap what is left by reviewer capacity (open review queue and weekly intake), the run
 * budget and `--max`.
 *
 * It reads the content repository and lists PRs; it never writes anything or calls an LLM.
 */
import type { LectioConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import type { GitHubClient, PullRequest } from '@lectio/providers';
import type { CalendarDay } from '@lectio/schema/calendar';
import { PASSAGE_KEY_PATTERN } from '@lectio/schema/common';
import { addDays, dateRange, isIsoDate } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

/** Branch prefix of research PRs: one branch (and PR) per passage, `research/<key>`. */
export const RESEARCH_BRANCH_PREFIX = 'research/';

/**
 * Label the merge rule puts on a PR that waits for a person. Open PRs with this label, together
 * with open research PRs whose gates have not finished yet, use reviewer capacity.
 */
export const NEEDS_REVIEW_LABEL = 'needs-review';

/** The research branch for a passage key. */
export function researchBranch(key: string): string {
  return `${RESEARCH_BRANCH_PREFIX}${key}`;
}

/** One passage to research. */
export interface WorkItem {
  readonly key: string;
  /** The lectionary reference at the passage's first date in the window (sub-verse letters kept). */
  readonly ref: string;
  readonly firstDate: IsoDate;
  /** Every date in the window (or, for `only` outside the window, from `from` on) with this key, ascending. */
  readonly dates: readonly IsoDate[];
}

/**
 * Why a scheduled passage is not planned: `exists` (the passage file is in the repository),
 * `open-pr` (an open PR on its research branch), or the cap that cut it off.
 */
export type SkipReason = 'exists' | 'open-pr' | LimitReason;

/** The cap that limits how many passages one run plans. */
export type LimitReason = 'capacity' | 'weekly' | 'budget' | 'max';

/** Days counted by `reviewer.weeklyCapacity`. */
export const WEEK_MS = 7 * 86_400_000;

export interface SkippedItem extends WorkItem {
  readonly reason: SkipReason;
  /** For `open-pr`: the PR number. */
  readonly pr?: number;
}

export interface PlanCapacity {
  /**
   * Open PRs that are or may become review work: those labelled `needs-review` plus open
   * non-fork PRs on `research/*` (their gates may still be running), each PR counted once.
   */
  readonly openReviewPrs: number;
  readonly maxOpenReviewPrs: number;
  /** How many more PRs reviewers can take: `maxOpenReviewPrs - openReviewPrs`, at least 0. */
  readonly available: number;
}

export interface PlanWeekly {
  /** Non-fork PRs on `research/*` (any state) created in the 7 days before `now`. */
  readonly openedLast7Days: number;
  readonly weeklyCapacity: number;
  /** `weeklyCapacity - openedLast7Days`, at least 0. */
  readonly available: number;
}

export interface PlanBudget {
  /** The up-front estimate per passage (`research.budget.perPassageUsd` unless overridden). */
  readonly perPassageUsd: number;
  /** The run ceiling (`research.budget.perRunUsd` unless overridden). */
  readonly perRunUsd: number;
  /** Passages the run budget covers at the estimate; `null` when the estimate is 0 (no limit). */
  readonly affordable: number | null;
  /** Estimated cost of the planned items. */
  readonly estimatedUsd: number;
}

export interface Plan {
  readonly from: IsoDate;
  /** Last date of the window (inclusive): `from + days - 1`. */
  readonly to: IsoDate;
  readonly days: number;
  /** What to research, in order: first date, then calendar order within that day. */
  readonly items: readonly WorkItem[];
  /** Scheduled passages not planned, in the same order, with the reason. */
  readonly skipped: readonly SkippedItem[];
  /** `only` was given but the key has no calendar date from `from` on. */
  readonly unscheduled: readonly string[];
  /** Window dates the calendar has no day for (for example a year whose calendar is not generated). */
  readonly missingDates: readonly IsoDate[];
  /** Window dates whose calendar day says the lectionary data is missing. */
  readonly lectionaryMissingDates: readonly IsoDate[];
  readonly capacity: PlanCapacity;
  readonly weekly: PlanWeekly;
  readonly budget: PlanBudget;
  /** The most items this run may plan: the tightest of capacity, weekly intake, budget and `max`. */
  readonly limit: number;
  /** The cap that cut off at least one passage, or `null` when every candidate fit. */
  readonly limitedBy: LimitReason | null;
}

export interface PlanInput {
  readonly from: IsoDate;
  /** Window length in days, at least 1. */
  readonly days: number;
  readonly repo: Pick<ContentRepo, 'calendarYear' | 'passageKeys' | 'datesForPassage'>;
  readonly github: Pick<GitHubClient, 'listPrs'>;
  readonly config: Pick<LectioConfig, 'reviewer' | 'research'>;
  /** "Now", for the 7-day window of `reviewer.weeklyCapacity`. */
  readonly now: Date;
  /** Plan this passage key only. Outside the window, its calendar dates from `from` on are used. */
  readonly only?: string;
  /** Plan at most this many passages (at least 1). */
  readonly max?: number;
  /** Override the per-passage estimate (for example a measured average); default `research.budget.perPassageUsd`. */
  readonly perPassageUsd?: number;
  /** Override the run ceiling (for example back-fill's `backfillTotalUsd`); default `research.budget.perRunUsd`. */
  readonly perRunUsd?: number;
}

const KEY_SHAPE = new RegExp(PASSAGE_KEY_PATTERN);

/** Passage keys in calendar order: date, then Mass, then reading; `ref` is the first one seen. */
function collect(days: readonly CalendarDay[], accept: (key: string) => boolean): WorkItem[] {
  const items = new Map<string, { key: string; ref: string; firstDate: IsoDate; dates: IsoDate[] }>();
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const mass of day.masses) {
      for (const { key, ref } of mass.readings) {
        if (!accept(key)) continue;
        const item = items.get(key);
        if (item === undefined) items.set(key, { key, ref, firstDate: day.date, dates: [day.date] });
        else if (item.dates.at(-1) !== day.date) item.dates.push(day.date);
      }
    }
  }
  return [...items.values()];
}

function calendarDays(repo: PlanInput['repo'], dates: readonly IsoDate[]): Map<IsoDate, CalendarDay> {
  const wanted = new Set(dates);
  const found = new Map<IsoDate, CalendarDay>();
  for (const year of new Set(dates.map((date) => Number(date.slice(0, 4))))) {
    for (const day of repo.calendarYear(year)?.days ?? []) if (wanted.has(day.date)) found.set(day.date, day);
  }
  return found;
}

function assertInput(input: PlanInput): void {
  if (!isIsoDate(input.from))
    throw new RangeError(`from must be an ISO date (YYYY-MM-DD), got ${JSON.stringify(input.from)}`);
  if (!Number.isInteger(input.days) || input.days < 1)
    throw new RangeError(`days must be a positive integer, got ${input.days}`);
  if (input.max !== undefined && (!Number.isInteger(input.max) || input.max < 1)) {
    throw new RangeError(`max must be a positive integer, got ${input.max}`);
  }
  if (input.only !== undefined && !KEY_SHAPE.test(input.only)) {
    throw new RangeError(`only must be a passage key, got ${JSON.stringify(input.only)}`);
  }
  if (input.perPassageUsd !== undefined && !(input.perPassageUsd >= 0)) {
    throw new RangeError(`perPassageUsd must be a non-negative number, got ${input.perPassageUsd}`);
  }
  if (input.perRunUsd !== undefined && !(input.perRunUsd >= 0)) {
    throw new RangeError(`perRunUsd must be a non-negative number, got ${input.perRunUsd}`);
  }
  if (Number.isNaN(input.now.getTime())) throw new RangeError('now must be a valid Date');
}

const roundCents = (usd: number): number => Math.round(usd * 100) / 100;

/** Plans one research run. See the module comment for the rules. */
export async function plan(input: PlanInput): Promise<Plan> {
  assertInput(input);
  const { from, days, repo, github, config, only, max } = input;
  const to = addDays(from, days - 1);
  const window = dateRange(from, to);
  const byDate = calendarDays(repo, window);

  const missingDates = window.filter((date) => !byDate.has(date));
  const lectionaryMissingDates = window.filter((date) => byDate.get(date)?.lectionaryMissing === true);

  const accept = (key: string): boolean => only === undefined || key === only;
  let candidates = collect([...byDate.values()], accept);
  const unscheduled: string[] = [];
  if (only !== undefined && candidates.length === 0) {
    const later = repo.datesForPassage(only).filter((date) => date >= from);
    candidates = collect([...calendarDays(repo, later).values()], accept);
    if (candidates.length === 0) unscheduled.push(only);
  }

  const existing = new Set(repo.passageKeys());
  const prs = await github.listPrs({ state: 'all' });
  const isResearch = (pr: PullRequest): boolean => !pr.fork && pr.head.startsWith(RESEARCH_BRANCH_PREFIX);
  const openPrs = prs.filter((pr) => pr.state === 'open');
  // Fork PRs never block a key: anyone can name a fork branch `research/<key>`.
  const prByBranch = new Map(openPrs.filter((pr) => !pr.fork).map((pr) => [pr.head, pr.number]));
  const openReviewPrs = openPrs.filter((pr) => pr.labels.includes(NEEDS_REVIEW_LABEL) || isResearch(pr)).length;
  const weekStart = input.now.getTime() - WEEK_MS;
  const openedLast7Days = prs.filter((pr) => isResearch(pr) && Date.parse(pr.createdAt) > weekStart).length;

  const { maxOpenReviewPrs, weeklyCapacity } = config.reviewer;
  const available = Math.max(0, maxOpenReviewPrs - openReviewPrs);
  const weeklyAvailable = Math.max(0, weeklyCapacity - openedLast7Days);
  const perPassageUsd = input.perPassageUsd ?? config.research.budget.perPassageUsd;
  const perRunUsd = input.perRunUsd ?? config.research.budget.perRunUsd;
  // A small epsilon so 25 / 1.25 counts as 20 despite floating point.
  const affordable = perPassageUsd === 0 ? null : Math.floor(perRunUsd / perPassageUsd + 1e-9);

  // The tightest cap wins; on a tie the earlier one (capacity, weekly, budget, max) is reported.
  let limit = available;
  let limitReason: LimitReason = 'capacity';
  if (weeklyAvailable < limit) [limit, limitReason] = [weeklyAvailable, 'weekly'];
  if (affordable !== null && affordable < limit) [limit, limitReason] = [affordable, 'budget'];
  if (max !== undefined && max < limit) [limit, limitReason] = [max, 'max'];

  const items: WorkItem[] = [];
  const skipped: SkippedItem[] = [];
  let limitedBy: LimitReason | null = null;
  for (const item of candidates) {
    const pr = prByBranch.get(researchBranch(item.key));
    if (existing.has(item.key)) skipped.push({ ...item, reason: 'exists' });
    else if (pr !== undefined) skipped.push({ ...item, reason: 'open-pr', pr });
    else if (items.length >= limit) {
      skipped.push({ ...item, reason: limitReason });
      limitedBy = limitReason;
    } else items.push(item);
  }

  return {
    from,
    to,
    days,
    items,
    skipped,
    unscheduled,
    missingDates,
    lectionaryMissingDates,
    capacity: { openReviewPrs, maxOpenReviewPrs, available },
    weekly: { openedLast7Days, weeklyCapacity, available: weeklyAvailable },
    budget: { perPassageUsd, perRunUsd, affordable, estimatedUsd: roundCents(items.length * perPassageUsd) },
    limit,
    limitedBy,
  };
}
