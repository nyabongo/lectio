import { describe, expect, it } from 'vitest';

import { fixtureRepo } from './fixtures/memory-repo.ts';
import { computeRunway, isExceeded, missingPassages } from './runway.ts';

describe('computeRunway', () => {
  it('reports nothing when every reading in the window has an approved note', () => {
    const repo = fixtureRepo({
      days: { '2026-10-05': [['IS.55.6-9', 'MT.20.1-16']], '2026-10-06': [['MT.20.1-16']] },
      approved: ['IS.55.6-9', 'MT.20.1-16'],
    });
    expect(computeRunway({ from: '2026-10-05', windowDays: 2, repo })).toEqual({
      from: '2026-10-05',
      to: '2026-10-06',
      windowDays: 2,
      days: [],
    });
  });

  it('lists days with absent or unapproved notes and their missing keys, across Masses, sorted and unique', () => {
    const repo = fixtureRepo({
      days: {
        '2026-10-05': [['IS.55.6-9', 'MT.20.1-16']],
        '2026-10-06': [
          ['MT.20.1-16', 'PHIL.1.20-24'],
          ['LK.2.16-21', 'PHIL.1.20-24'],
        ],
        '2026-10-07': [['MT.20.1-16']],
      },
      approved: ['MT.20.1-16'],
      pending: ['IS.55.6-9'],
    });
    const report = computeRunway({ from: '2026-10-05', windowDays: 3, repo });
    expect(report.days).toEqual([
      { date: '2026-10-05', reason: 'notes', missing: ['IS.55.6-9'] },
      { date: '2026-10-06', reason: 'notes', missing: ['LK.2.16-21', 'PHIL.1.20-24'] },
    ]);
    expect(missingPassages(report)).toEqual(['IS.55.6-9', 'LK.2.16-21', 'PHIL.1.20-24']);
  });

  it('crosses a year boundary and counts dates without a calendar entry', () => {
    const repo = fixtureRepo({ days: { '2026-12-31': [['MT.20.1-16']], '2027-01-01': [[]] }, approved: [] });
    const report = computeRunway({ from: '2026-12-30', windowDays: 4, repo });
    expect(report.to).toBe('2027-01-02');
    expect(report.days).toEqual([
      { date: '2026-12-30', reason: 'no-calendar', missing: [] },
      { date: '2026-12-31', reason: 'notes', missing: ['MT.20.1-16'] },
      { date: '2027-01-02', reason: 'no-calendar', missing: [] },
    ]);
  });

  it('does not report a day without readings (nothing to research)', () => {
    const repo = fixtureRepo({ days: { '2027-01-01': [] } });
    expect(computeRunway({ from: '2027-01-01', windowDays: 1, repo }).days).toEqual([]);
  });

  it('rejects a bad date or window', () => {
    const repo = fixtureRepo({ days: {} });
    expect(() => computeRunway({ from: '2026-13-01', windowDays: 1, repo })).toThrow(/from must be an ISO date/);
    expect(() => computeRunway({ from: '2026-10-05', windowDays: 0, repo })).toThrow(/positive integer/);
    expect(() => computeRunway({ from: '2026-10-05', windowDays: 1.5, repo })).toThrow(/positive integer/);
  });
});

describe('isExceeded', () => {
  const report = (n: number) => ({
    from: '2026-10-05',
    to: '2026-10-25',
    windowDays: 21,
    days: Array.from({ length: n }, (_, i) => ({
      date: `2026-10-${String(5 + i)}`,
      reason: 'notes' as const,
      missing: [],
    })),
  });

  it('is true only when the missing days are more than the maximum', () => {
    expect(isExceeded(report(7), 7)).toBe(false);
    expect(isExceeded(report(8), 7)).toBe(true);
    expect(isExceeded(report(0), 0)).toBe(false);
    expect(isExceeded(report(1), 0)).toBe(true);
  });
});
