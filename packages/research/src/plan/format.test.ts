import { describe, expect, it } from 'vitest';

import { formatPlan } from './format.ts';
import type { Plan, SkippedItem } from './plan.ts';

const item = (key: string, firstDate: string) => ({ key, ref: `ref ${key}`, firstDate, dates: [firstDate] });

const base: Plan = {
  from: '2026-10-01',
  to: '2026-10-14',
  days: 14,
  items: [item('LK.10.1-12', '2026-10-01')],
  skipped: [],
  unscheduled: [],
  missingDates: [],
  lectionaryMissingDates: [],
  capacity: { openReviewPrs: 2, maxOpenReviewPrs: 15, available: 13 },
  budget: { perPassageUsd: 1.5, perRunUsd: 25, affordable: 16, estimatedUsd: 1.5 },
  limit: 13,
  limitedBy: null,
};

describe('formatPlan', () => {
  it('prints the window, capacity, budget and items', () => {
    expect(formatPlan(base)).toBe(
      [
        'Research plan 2026-10-01 to 2026-10-14 (14 days)',
        'Reviewer capacity: 2 of 15 review PRs open, room for 13',
        'Budget: $1.50 per passage, $25.00 per run, room for 16',
        '',
        'To research (1, estimated $1.50):',
        '  2026-10-01  LK.10.1-12  (ref LK.10.1-12)',
        '',
      ].join('\n'),
    );
  });

  it('prints skips, the binding cap, unscheduled keys and calendar gaps', () => {
    const skipped: SkippedItem[] = [
      { ...item('IS.55.6-9', '2026-10-02'), reason: 'exists' },
      { ...item('PS.139.1-3', '2026-10-02'), reason: 'open-pr', pr: 7 },
      { ...item('GN.2.18-24', '2026-10-04'), reason: 'capacity' },
      { ...item('MK.10.2-16', '2026-10-04'), reason: 'budget' },
      { ...item('GAL.1.13-24', '2026-10-06'), reason: 'max' },
    ];
    const text = formatPlan({
      ...base,
      items: [],
      skipped,
      unscheduled: ['RV.22.1-5'],
      missingDates: ['2026-10-05', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12'],
      lectionaryMissingDates: ['2026-10-03'],
      budget: { ...base.budget, affordable: null, estimatedUsd: 0 },
      limitedBy: 'max',
      limit: 1,
    });
    expect(text).toContain('Budget: $1.50 per passage, $25.00 per run\n');
    expect(text).toContain('To research (0, estimated $0.00):\n  (none)\n');
    expect(text).toContain(
      [
        'Skipped (5):',
        '  2026-10-02  IS.55.6-9  passage file exists',
        '  2026-10-02  PS.139.1-3  open PR #7',
        '  2026-10-04  GN.2.18-24  reviewer capacity reached',
        '  2026-10-04  MK.10.2-16  run budget reached',
        '  2026-10-06  GAL.1.13-24  --max reached',
      ].join('\n'),
    );
    expect(text).toContain('Limited by max: at most 1 this run.');
    expect(text).toContain('Not in any calendar from 2026-10-01: RV.22.1-5');
    expect(text).toContain(
      'No calendar day for 7 date(s): 2026-10-05, 2026-10-07, 2026-10-08, 2026-10-09, 2026-10-10 and 2 more',
    );
    expect(text).toContain('Lectionary data missing for 1 date(s): 2026-10-03');
  });
});
