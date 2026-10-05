import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CalendarDay, CalendarYear } from '@lectio/schema/calendar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serialiseCalendar } from '../cli/build-year.ts';
import type { ReadingStats } from './report.ts';
import { reportContext, resolvedStats, runReport } from './run.ts';
import type { ReportContext, StatsOptions } from './run.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');

const STATS: ReadingStats = {
  readings: { provisional: 3, verified: 1, disputed: 0 },
  passages: { provisional: 3, verified: 1, disputed: 0 },
};

function day(date: string, id: string, name: string, missing: boolean): CalendarDay {
  return {
    date,
    season: 'easter',
    seasonWeek: 4,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations: [{ id, name, rank: 'feast', colour: 'white' }],
    masses: missing
      ? []
      : [
          {
            id: 'day',
            label: 'Mass of the day',
            readings: [
              {
                slot: 'gospel',
                ref: 'Jn 21:1-19',
                key: 'JN.21.1-19',
                linkout: 'https://www.drbo.org/chapter/50021.htm',
              },
            ],
          },
        ],
    lectionaryMissing: missing,
  };
}

function calendar(year: number, extra: CalendarDay[] = []): CalendarYear {
  const y = String(year);
  return {
    year,
    region: 'kenya',
    generatedBy: 'test',
    days: [
      day(`${y}-04-29`, 'saint-catherine-of-siena', 'Saint Catherine of Siena', false),
      day(`${y}-04-30`, 'our-lady-mother-of-africa', 'Our Lady Mother of Africa', true),
      ...extra,
    ],
  };
}

interface Harness {
  readonly root: string;
  readonly context: ReportContext;
  readonly calls: StatsOptions[];
  readonly out: string[];
  readonly err: string[];
  readonly io: { out: (line: string) => void; err: (line: string) => void };
  fail?: Error;
}

let h: Harness;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'lectio-calendar-report-'));
  mkdirSync(join(root, 'calendar'));
  const calls: StatsOptions[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const harness: Harness = {
    root,
    calls,
    out,
    err,
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    context: {
      repoRoot: root,
      stats: (options) => {
        calls.push(options);
        return harness.fail ? Promise.reject(harness.fail) : Promise.resolve(STATS);
      },
    },
  };
  h = harness;
});

afterEach(() => {
  rmSync(h.root, { recursive: true, force: true });
});

function write(year: number, text: string): void {
  writeFileSync(join(h.root, 'calendar', `${String(year)}.json`), text);
}

describe('runReport', () => {
  it('passes when every committed year is complete but for the known gaps', async () => {
    write(2026, serialiseCalendar(calendar(2026)));
    write(2028, serialiseCalendar(calendar(2028)));
    writeFileSync(join(h.root, 'calendar', 'notes.txt'), '');
    expect(await runReport([], h.context, h.io)).toBe(0);
    expect(h.calls).toEqual([
      { repoRoot: h.root, year: 2026, region: 'kenya' },
      { repoRoot: h.root, year: 2028, region: 'kenya' },
    ]);
    expect(h.err).toEqual([]);
    expect(h.out[0]).toBe(
      'calendar/2026.json (kenya): 2 days, 1 readings; 1 lectionaryMissing (1 known gap(s), 0 unexpected)',
    );
    expect(h.out).toContain('  readings by status: 3 provisional, 1 verified, 0 disputed');
    expect(h.out.at(-1)).toBe(
      'calendar:report: 0 unexpected missing day(s) in 2 year(s); 2 known gap(s) allowed; ' +
        'readings 6 provisional, 2 verified, 0 disputed',
    );
  });

  it('fails on a missing day no known gap allows, and on the given years only', async () => {
    write(2026, serialiseCalendar(calendar(2026, [day('2026-05-01', 'saint-joseph-the-worker', 'Joseph', true)])));
    write(2027, serialiseCalendar(calendar(2027)));
    expect(await runReport(['--year', '2026'], h.context, h.io)).toBe(1);
    expect(h.calls.map((c) => c.year)).toEqual([2026]);
    expect(h.out).toContain('  MISSING 2026-05-01: saint-joseph-the-worker (Joseph)');
    expect(h.err[0]).toMatch(/^calendar:report: 1 unexpected missing day\(s\) in 1 year\(s\)/);
    expect(h.err.join('\n')).toMatch(/KNOWN_GAPS in packages\/calendar\/src\/report\/gaps\.ts/);
    expect(h.err.join('\n')).not.toMatch(/could not be reported on/);
  });

  it('uses the gaps of the context when given', async () => {
    write(2026, serialiseCalendar(calendar(2026)));
    expect(await runReport([], { ...h.context, gaps: [] }, h.io)).toBe(1);
    expect(h.out).toContain('  MISSING 2026-04-30: our-lady-mother-of-africa (Our Lady Mother of Africa)');
  });

  it('fails on files that are missing, not JSON or invalid, and carries on', async () => {
    write(2027, '{ nope');
    write(2028, JSON.stringify({ year: 2028 }));
    write(2029, serialiseCalendar(calendar(2029)));
    const years = ['--year', '2026', '--year', '2027', '--year', '2028', '--year', '2029'];
    expect(await runReport(years, h.context, h.io)).toBe(1);
    expect(h.err[0]).toBe('calendar/2026.json: missing; run `npm run calendar:build -- --year 2026`');
    expect(h.err[1]).toMatch(/^calendar\/2027\.json: not JSON \(/);
    expect(h.err[2]).toMatch(/^calendar\/2028\.json: invalid:\n {2}schema: /);
    expect(h.calls.map((c) => c.year)).toEqual([2029]);
    expect(h.err).toContain('calendar:report: 3 calendar file(s) could not be reported on');
    expect(h.err.join('\n')).not.toMatch(/KNOWN_GAPS/);
  });

  it('fails when the readings cannot be resolved', async () => {
    write(2026, serialiseCalendar(calendar(2026)));
    h.fail = new Error('no overrides');
    expect(await runReport([], h.context, h.io)).toBe(1);
    expect(h.err[0]).toBe('calendar/2026.json: could not resolve the readings: no overrides');
    expect(h.err).toContain('calendar:report: 1 calendar file(s) could not be reported on');
  });

  it('fails without any calendar file', async () => {
    expect(await runReport([], h.context, h.io)).toBe(1);
    expect(h.err).toEqual(['calendar:report: no calendar/<year>.json files to report on']);
  });

  it('prints usage on bad arguments and on --region', async () => {
    expect(await runReport(['--bogus'], h.context, h.io)).toBe(2);
    expect(h.err[0]).toMatch(/^unexpected argument "--bogus"\nusage: calendar:report/);
    expect(await runReport(['--region', 'kenya'], h.context, h.io)).toBe(2);
    expect(h.err[1]).toMatch(/^calendar:report reads the region from each file\nusage: calendar:report/);
  });
});

describe('reportContext', () => {
  it('finds the repository from INIT_CWD, else cwd, and resolves the real statuses', () => {
    const context = reportContext({ INIT_CWD: join(repoRoot, 'packages', 'calendar') }, '/');
    expect(context.repoRoot).toBe(repoRoot);
    expect(context.stats).toBe(resolvedStats);
    expect(reportContext({}, join(repoRoot, 'packages')).repoRoot).toBe(repoRoot);
  });
});

describe('resolvedStats', () => {
  it('throws when the lectionary data has problems', async () => {
    const root = h.root;
    mkdirSync(join(root, 'calendar', 'overrides'));
    mkdirSync(join(root, 'calendar', 'lectionary'));
    copyFileSync(
      join(repoRoot, 'calendar', 'overrides', 'kenya.json'),
      join(root, 'calendar', 'overrides', 'kenya.json'),
    );
    await expect(resolvedStats({ repoRoot: root, year: 2026, region: 'kenya' })).rejects.toThrow(
      /calendar\/lectionary has problems/,
    );
  });
});

describe('the committed calendars 2026–2028 (L-070)', () => {
  it('exist for Kenya with no missing day beyond the known gaps, every reading counted by status', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (line: string) => out.push(line), err: (line: string) => err.push(line) };
    const years = ['--year', '2026', '--year', '2027', '--year', '2028'];
    expect(await runReport(years, reportContext({}, repoRoot), io)).toBe(0);
    expect(err).toEqual([]);
    const known = out.filter((line) => line.startsWith('  known gap '));
    expect(known.map((line) => line.split(' (')[0])).toEqual([
      '  known gap 2026-04-30: our-lady-mother-of-africa',
      '  known gap 2027-04-30: our-lady-mother-of-africa',
    ]);
    // Every reading in the files is one the resolver gives, so the status counts add up to the files' readings.
    for (const year of [2026, 2027, 2028]) {
      const header = out.find((line) => line.startsWith(`calendar/${String(year)}.json (kenya): `)) as string;
      const index = out.indexOf(header);
      const readings = Number(/, (\d+) readings;/.exec(header)?.[1]);
      const statuses = (out[index + 1] as string).match(/\d+/g)?.map(Number) ?? [];
      expect(statuses.reduce((a, b) => a + b, 0)).toBe(readings);
    }
  }, 120_000);
});
