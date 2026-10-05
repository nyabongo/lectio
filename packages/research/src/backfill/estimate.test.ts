import { DEFAULT_CONFIG } from '@lectio/config';
import type { LectioConfig } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { backfillWindow, estimateBackfill } from './estimate.ts';
import type { EstimateInput } from './estimate.ts';
import { CALENDARS, REPO, memoryRepo } from './fixtures/calendars.ts';

const input: EstimateInput = { fromYear: 2026, toYear: 2028, today: '2026-10-05', repo: REPO, config: DEFAULT_CONFIG };

function withConfig(
  budget: Partial<LectioConfig['research']['budget']>,
  reviewer: Partial<LectioConfig['reviewer']> = {},
): LectioConfig {
  return {
    ...DEFAULT_CONFIG,
    reviewer: { ...DEFAULT_CONFIG.reviewer, ...reviewer },
    research: { ...DEFAULT_CONFIG.research, budget: { ...DEFAULT_CONFIG.research.budget, ...budget } },
  };
}

describe('estimateBackfill', () => {
  it('counts unique keys minus existing, ordered by next occurrence, past-only keys last', () => {
    const estimate = estimateBackfill(input);
    expect(estimate).toMatchObject({
      fromYear: 2026,
      toYear: 2028,
      today: '2026-10-05',
      years: [2026, 2027],
      missingYears: [2028],
      lectionaryMissingDays: 1,
      totalKeys: 4,
      existing: 1,
      perPassageUsd: 1.5,
      perPassageSource: 'config',
      estimatedUsd: 4.5,
      ceilingUsd: 0,
      ceilingCovers: 0,
      // perRunUsd $25 pays for 16; reviewer capacity and weekly intake allow 15.
      batchSize: 15,
      batches: 1,
      weeks: 1,
    });
    expect(estimate.remaining).toEqual([
      { key: 'JN.1.1', ref: 'Jn 1:1 (next)', nextDate: '2026-10-05', firstDate: '2026-01-10' },
      { key: 'LK.1.1', ref: 'Lk 1:1', nextDate: '2026-10-06', firstDate: '2026-10-06' },
      { key: 'MK.1.1', ref: 'Mk 1:1', nextDate: null, firstDate: '2026-01-10' },
    ]);
  });

  it('uses a measured average, and the ceiling and batch sizes it implies', () => {
    const config = withConfig({ backfillTotalUsd: 2, perRunUsd: 2 }, { weeklyCapacity: 2 });
    const estimate = estimateBackfill({ ...input, config, perPassageUsd: 1 });
    expect(estimate).toMatchObject({
      perPassageUsd: 1,
      perPassageSource: 'measured',
      estimatedUsd: 3,
      ceilingUsd: 2,
      spentUsd: 0,
      leftUsd: 2,
      ceilingCovers: 2,
      batchSize: 2,
      batches: 2,
      weeks: 2,
    });
  });

  it('counts the ceiling left after what the ledger says earlier batches spent', () => {
    const config = withConfig({ backfillTotalUsd: 5 });
    expect(estimateBackfill({ ...input, config, perPassageUsd: 1, spentUsd: 3.5 })).toMatchObject({
      spentUsd: 3.5,
      leftUsd: 1.5,
      ceilingCovers: 1,
    });
    expect(estimateBackfill({ ...input, config, spentUsd: 7 })).toMatchObject({ leftUsd: 0, ceilingCovers: 0 });
  });

  it('has no cost limit at a $0 average, and no batches without reviewer capacity', () => {
    const free = estimateBackfill({ ...input, perPassageUsd: 0 });
    expect(free).toMatchObject({ estimatedUsd: 0, ceilingCovers: null, batchSize: 15 });
    const none = estimateBackfill({ ...input, config: withConfig({}, { weeklyCapacity: 0 }) });
    expect(none).toMatchObject({ batchSize: 0, batches: null, weeks: null });
  });

  it('counts nothing when every key is written or the years have no calendar', () => {
    const done = estimateBackfill({ ...input, repo: memoryRepo(CALENDARS, ['JN.1.1', 'LK.1.1', 'MK.1.1', 'MT.1.1']) });
    expect(done).toMatchObject({ totalKeys: 4, existing: 4, remaining: [], estimatedUsd: 0, batches: 0 });
    const empty = estimateBackfill({ ...input, fromYear: 2030, toYear: 2030 });
    expect(empty).toMatchObject({ years: [], missingYears: [2030], totalKeys: 0, remaining: [] });
  });
});

describe('backfillWindow', () => {
  it('runs from today to the end of the last year while keys are upcoming', () => {
    // 88 days left in 2026, then 365 and 366.
    expect(backfillWindow(estimateBackfill(input))).toEqual({ from: '2026-10-05', days: 88 + 365 + 366 });
  });

  it('starts at the first year when today is earlier, or when only past keys are left', () => {
    expect(backfillWindow(estimateBackfill({ ...input, fromYear: 2027, toYear: 2027 }))).toEqual({
      from: '2027-01-01',
      days: 365,
    });
    const pastOnly = estimateBackfill({
      ...input,
      toYear: 2026,
      repo: memoryRepo(CALENDARS, ['JN.1.1', 'LK.1.1', 'MT.1.1']),
    });
    expect(pastOnly.remaining.map((entry) => entry.key)).toEqual(['MK.1.1']);
    expect(backfillWindow(pastOnly)).toEqual({ from: '2026-01-01', days: 365 });
  });
});
