import { DEFAULT_CONFIG } from '@lectio/config';
import { describe, expect, it } from 'vitest';

import { estimateBackfill } from './estimate.ts';
import type { BackfillEstimate, BackfillKey } from './estimate.ts';
import { CALENDARS, REPO, day, memoryRepo, year } from './fixtures/calendars.ts';
import { PREVIEW_KEYS, formatEstimate } from './format.ts';

const base = estimateBackfill({
  fromYear: 2026,
  toYear: 2028,
  today: '2026-10-05',
  repo: REPO,
  config: DEFAULT_CONFIG,
});

describe('formatEstimate', () => {
  it('prints the key count, the estimated cost and that a $0 ceiling generates nothing', () => {
    expect(formatEstimate(base)).toBe(
      [
        'Back-fill estimate for 2026–2028 as of 2026-10-05',
        'Passage keys: 4 in the calendars, 1 already written, 3 to research',
        'Estimated cost: $4.50 (3 × $1.50 per passage, research.budget.perPassageUsd)',
        'Back-fill ceiling: $0.00 (research.budget.backfillTotalUsd): estimate only, nothing is generated.',
        'Batches: 1 of at most 15 passages (reviewer capacity, weekly intake and research.budget.perRunUsd), ' +
          'about 1 week(s) of reviewer intake',
        'No calendar for 2028: those years are not counted.',
        'Lectionary data missing for 1 day(s): not counted.',
        '',
        'Next 3 in back-fill order:',
        '  2026-10-05  JN.1.1  (Jn 1:1 (next))',
        '  2026-10-06  LK.1.1  (Lk 1:1)',
        '  2026-01-10 (past)  MK.1.1  (Mk 1:1)',
      ].join('\n'),
    );
  });

  it('says how much of the back-fill a positive ceiling covers', () => {
    const covered: BackfillEstimate = { ...base, ceilingUsd: 10, leftUsd: 10, ceilingCovers: 6 };
    expect(formatEstimate(covered)).toContain(
      'Back-fill ceiling: $10.00 (research.budget.backfillTotalUsd): $0.00 spent so far, $10.00 left; ' +
        'covers every remaining passage.',
    );
    const free: BackfillEstimate = { ...base, ceilingUsd: 1, leftUsd: 1, ceilingCovers: null };
    expect(formatEstimate(free)).toContain('covers every remaining passage.');
    const short: BackfillEstimate = { ...base, ceilingUsd: 5, spentUsd: 2, leftUsd: 3, ceilingCovers: 2 };
    expect(formatEstimate(short)).toContain('$2.00 spent so far, $3.00 left; covers 2 of 3 passages; $1.50 short.');
  });

  it('says when earlier batches used the ceiling up', () => {
    const spent: BackfillEstimate = { ...base, ceilingUsd: 5, spentUsd: 5, leftUsd: 0, ceilingCovers: 0 };
    expect(formatEstimate(spent)).toContain(
      'Back-fill ceiling: $5.00 (research.budget.backfillTotalUsd): $5.00 spent so far, $0.00 left; ' +
        'used up, nothing more is generated.',
    );
  });

  it('names a measured average, a single year, and a run with no batches', () => {
    const measured: BackfillEstimate = {
      ...base,
      toYear: 2026,
      missingYears: [],
      lectionaryMissingDays: 0,
      perPassageSource: 'measured',
      batches: null,
      weeks: null,
    };
    const text = formatEstimate(measured);
    expect(text).toContain('Back-fill estimate for 2026 as of');
    expect(text).toContain('per passage, measured average)');
    expect(text).toContain('Batches: none possible (reviewer capacity or the run budget is 0)');
    expect(text).not.toContain('No calendar');
    expect(text).not.toContain('Lectionary data missing');
    expect(formatEstimate({ ...base, weeks: null })).toMatch(/research\.budget\.perRunUsd\)$/mu);
  });

  it('lists the first keys only, and nothing when the back-fill is done', () => {
    const keys: BackfillKey[] = Array.from({ length: PREVIEW_KEYS + 2 }, (_, index) => ({
      key: `PS.${String(index + 1)}`,
      ref: `Ps ${String(index + 1)}`,
      nextDate: '2026-10-05',
      firstDate: '2026-10-05',
    }));
    const text = formatEstimate({ ...base, remaining: keys });
    expect(text).toContain(`Next ${String(PREVIEW_KEYS)} in back-fill order:`);
    expect(text).toContain('  2026-10-05  PS.10  (Ps 10)');
    expect(text).not.toContain('PS.11');
    expect(text.endsWith('  … and 2 more')).toBe(true);

    const done = estimateBackfill({
      fromYear: 2026,
      toYear: 2026,
      today: '2026-10-05',
      repo: memoryRepo([year(2026, [day('2026-10-05', [['MT.1.1', 'Mt 1:1']])]), ...CALENDARS.slice(1)], ['MT.1.1']),
      config: DEFAULT_CONFIG,
    });
    expect(formatEstimate(done)).not.toContain('back-fill order');
  });
});
