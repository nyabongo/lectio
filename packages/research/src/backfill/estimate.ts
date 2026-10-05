/**
 * The back-fill estimate: every unique passage key in the calendars of the chosen years, minus the
 * passages the repository already has, ordered by next occurrence (keys whose dates are all past
 * come last, in calendar order), and what researching them would cost at the per-passage average.
 *
 * It reads the content repository only: no GitHub, no LLM. Keys with an open research PR are
 * still counted here; the planner skips them when a batch runs.
 */
import type { LectioConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import type { CalendarDay } from '@lectio/schema/calendar';
import { dateRange } from '@lectio/shared';
import type { IsoDate } from '@lectio/shared';

/** One passage back-fill still has to research. */
export interface BackfillKey {
  readonly key: string;
  /** The lectionary reference at the date the key is ordered by. */
  readonly ref: string;
  /** The first date on or after `today`, or `null` when every date in the years is past. */
  readonly nextDate: IsoDate | null;
  /** The first date in the years. */
  readonly firstDate: IsoDate;
}

export interface BackfillEstimate {
  readonly fromYear: number;
  readonly toYear: number;
  readonly today: IsoDate;
  /** Years in the range that have a calendar file. */
  readonly years: readonly number[];
  /** Years in the range without a calendar file: their keys are not counted. */
  readonly missingYears: readonly number[];
  /** Calendar days whose lectionary data is missing: their readings are not counted. */
  readonly lectionaryMissingDays: number;
  /** Unique passage keys in the calendars. */
  readonly totalKeys: number;
  /** Of those, keys whose passage file exists. */
  readonly existing: number;
  /** What is left, in back-fill order. */
  readonly remaining: readonly BackfillKey[];
  readonly perPassageUsd: number;
  /** `measured` when the average came from `--per-passage`, else `config` (`research.budget.perPassageUsd`). */
  readonly perPassageSource: 'measured' | 'config';
  /** `remaining × perPassageUsd`, rounded to cents. */
  readonly estimatedUsd: number;
  /** `research.budget.backfillTotalUsd`; 0 means back-fill only ever prints this estimate. */
  readonly ceilingUsd: number;
  /** Passages the ceiling pays for at the average; `null` when the average is 0 (no limit). */
  readonly ceilingCovers: number | null;
  /**
   * The most passages one batch can take: the tightest of `reviewer.maxOpenReviewPrs`,
   * `reviewer.weeklyCapacity` and what `research.budget.perRunUsd` pays for.
   */
  readonly batchSize: number;
  /** Batches needed for what is left; `null` when the batch size is 0. */
  readonly batches: number | null;
  /** Weeks of reviewer intake (`reviewer.weeklyCapacity`) for what is left; `null` when it is 0. */
  readonly weeks: number | null;
}

export interface EstimateInput {
  readonly fromYear: number;
  readonly toYear: number;
  readonly today: IsoDate;
  readonly repo: Pick<ContentRepo, 'calendarYear' | 'passageKeys'>;
  readonly config: Pick<LectioConfig, 'reviewer' | 'research'>;
  /** A measured per-passage average; default `research.budget.perPassageUsd`. */
  readonly perPassageUsd?: number;
}

const roundCents = (usd: number): number => Math.round(usd * 100) / 100;

/** Keys in calendar order (date, Mass, reading), the first date and reference each one is seen with. */
function collect(days: readonly CalendarDay[]): Map<string, { ref: string; date: IsoDate }> {
  const keys = new Map<string, { ref: string; date: IsoDate }>();
  for (const day of days) {
    if (day.lectionaryMissing) continue;
    for (const mass of day.masses) {
      for (const { key, ref } of mass.readings) if (!keys.has(key)) keys.set(key, { ref, date: day.date });
    }
  }
  return keys;
}

const fits = (budgetUsd: number, perPassageUsd: number): number | null =>
  // A small epsilon so 25 / 1.25 counts as 20 despite floating point.
  perPassageUsd === 0 ? null : Math.floor(budgetUsd / perPassageUsd + 1e-9);

/** Estimates the back-fill of `fromYear`–`toYear` as of `today`. */
export function estimateBackfill(input: EstimateInput): BackfillEstimate {
  const { fromYear, toYear, today, repo, config } = input;
  const years: number[] = [];
  const missingYears: number[] = [];
  const days: CalendarDay[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const calendar = repo.calendarYear(year);
    if (calendar === null) missingYears.push(year);
    else {
      years.push(year);
      days.push(...calendar.days);
    }
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const lectionaryMissingDays = days.filter((day) => day.lectionaryMissing).length;

  const all = collect(days);
  const upcoming = collect(days.filter((day) => day.date >= today));
  const existing = new Set(repo.passageKeys());
  const remaining: BackfillKey[] = [];
  for (const [key, next] of upcoming) {
    if (!existing.has(key)) {
      remaining.push({ key, ref: next.ref, nextDate: next.date, firstDate: (all.get(key) as { date: IsoDate }).date });
    }
  }
  for (const [key, first] of all) {
    if (!existing.has(key) && !upcoming.has(key)) {
      remaining.push({ key, ref: first.ref, nextDate: null, firstDate: first.date });
    }
  }

  const perPassageUsd = input.perPassageUsd ?? config.research.budget.perPassageUsd;
  const { backfillTotalUsd, perRunUsd } = config.research.budget;
  const { maxOpenReviewPrs, weeklyCapacity } = config.reviewer;
  const runCovers = fits(perRunUsd, perPassageUsd);
  const batchSize = Math.min(maxOpenReviewPrs, weeklyCapacity, runCovers ?? Number.POSITIVE_INFINITY);
  const per = (size: number): number | null => (size === 0 ? null : Math.ceil(remaining.length / size));

  return {
    fromYear,
    toYear,
    today,
    years,
    missingYears,
    lectionaryMissingDays,
    totalKeys: all.size,
    existing: [...all.keys()].filter((key) => existing.has(key)).length,
    remaining,
    perPassageUsd,
    perPassageSource: input.perPassageUsd === undefined ? 'config' : 'measured',
    estimatedUsd: roundCents(remaining.length * perPassageUsd),
    ceilingUsd: backfillTotalUsd,
    ceilingCovers: fits(backfillTotalUsd, perPassageUsd),
    batchSize,
    batches: per(batchSize),
    weeks: per(weeklyCapacity),
  };
}

/** The planner window of the next batch: `from` and `days` up to the end of `toYear`. */
export interface BackfillWindow {
  readonly from: IsoDate;
  readonly days: number;
}

/**
 * The window the next batch plans: from `today` (or the first day of `fromYear`, if later) to the
 * end of `toYear`, so the planner orders keys by next occurrence. When no remaining key has an
 * upcoming date, the window starts at the first day of `fromYear` to pick up the past-only keys.
 */
export function backfillWindow(estimate: BackfillEstimate): BackfillWindow {
  const start: IsoDate = `${String(estimate.fromYear)}-01-01`;
  const end: IsoDate = `${String(estimate.toYear)}-12-31`;
  const upcoming = estimate.remaining.some((entry) => entry.nextDate !== null);
  const from = upcoming && estimate.today > start ? estimate.today : start;
  // `from` is never after `end` here: an upcoming date is on or before the end of `toYear`.
  return { from, days: dateRange(from, end).length };
}
