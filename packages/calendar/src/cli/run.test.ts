import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import type { CalendarYear } from '@lectio/schema/calendar';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildYear, serialiseCalendar } from './build-year.ts';
import type { BuildOptions, BuildResult } from './build-year.ts';
import { committedYears, firstDifference, parseArgs, processContext, runBuild, runCheck } from './run.ts';
import type { CliContext } from './run.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function calendarFor(year: number, region: string, generatedBy = 'fake'): CalendarYear {
  return {
    year,
    region,
    generatedBy,
    days: [
      {
        date: `${String(year)}-01-01`,
        season: 'christmas',
        seasonWeek: 0,
        sundayCycle: 'A',
        weekdayCycle: 'II',
        celebrations: [{ id: 'mary-mother-of-god', name: 'Mary, Mother of God', rank: 'solemnity', colour: 'white' }],
        masses: [],
        lectionaryMissing: true,
      },
    ],
  };
}

interface Harness {
  readonly root: string;
  readonly context: CliContext;
  readonly calls: BuildOptions[];
  readonly out: string[];
  readonly err: string[];
  readonly io: { out: (line: string) => void; err: (line: string) => void };
  generatedBy: string;
  fail?: Error;
}

let harness: Harness;

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'lectio-calendar-cli-'));
  mkdirSync(join(root, 'calendar'));
  const calls: BuildOptions[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const h: Harness = {
    root,
    calls,
    out,
    err,
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    generatedBy: 'fake',
    context: {
      repoRoot: root,
      config: DEFAULT_CONFIG,
      build: (options) => {
        calls.push(options);
        if (h.fail) return Promise.reject(h.fail);
        const result: BuildResult = {
          calendar: calendarFor(options.year, options.region, h.generatedBy),
          warnings: options.year === 2027 ? ['something odd'] : [],
        };
        return Promise.resolve(result);
      },
    },
  };
  harness = h;
});

afterEach(() => {
  rmSync(harness.root, { recursive: true, force: true });
});

const read = (year: number): string => readFileSync(join(harness.root, 'calendar', `${String(year)}.json`), 'utf8');
const write = (year: number, text: string): void => {
  writeFileSync(join(harness.root, 'calendar', `${String(year)}.json`), text);
};

describe('parseArgs', () => {
  it('reads years and a region', () => {
    expect(parseArgs([])).toEqual({ years: [] });
    expect(parseArgs(['--year', '2026', '--region', 'kenya', '--year', '2027', '--year', '2026'])).toEqual({
      years: [2026, 2027],
      region: 'kenya',
    });
  });

  it('rejects bad input', () => {
    expect(parseArgs(['--year'])).toBe('unexpected argument "--year"');
    expect(parseArgs(['--year', '26'])).toBe('unexpected argument "--year" "26"');
    expect(parseArgs(['--year', '1969'])).toBe('--year must be from 1970 to 9999');
    expect(parseArgs(['--region', 'Kenya'])).toBe('unexpected argument "--region" "Kenya"');
    expect(parseArgs(['--region', 'kenya', '--region', 'uganda'])).toBe('unexpected argument "--region" "uganda"');
    expect(parseArgs(['--out', 'x'])).toBe('unexpected argument "--out" "x"');
  });
});

describe('runBuild', () => {
  it('writes each year for the given region', async () => {
    const code = await runBuild(
      ['--year', '2026', '--year', '2027', '--region', 'uganda'],
      harness.context,
      harness.io,
    );
    expect(code).toBe(0);
    expect(harness.calls.map((c) => [c.year, c.region, c.repoRoot])).toEqual([
      [2026, 'uganda', harness.root],
      [2027, 'uganda', harness.root],
    ]);
    expect(read(2026)).toBe(serialiseCalendar(calendarFor(2026, 'uganda')));
    expect(harness.out).toEqual([
      'calendar:build 2026 (uganda): 1 days, 0 readings, 1 lectionaryMissing → calendar/2026.json',
      'calendar:build 2027 (uganda): 1 days, 0 readings, 1 lectionaryMissing → calendar/2027.json',
    ]);
    expect(harness.err).toEqual(['  warning: something odd']);
  });

  it('defaults the region to site.region', async () => {
    expect(await runBuild(['--year', '2026'], harness.context, harness.io)).toBe(0);
    expect(harness.calls[0]?.region).toBe(DEFAULT_CONFIG.site.region);
  });

  it('counts readings in the summary', async () => {
    const calendar = calendarFor(2026, 'kenya');
    const [first] = calendar.days as [CalendarYear['days'][number]];
    const withReadings: CalendarYear = {
      ...calendar,
      days: [
        {
          ...first,
          lectionaryMissing: false,
          masses: [
            {
              id: 'day',
              label: 'Mass of the day',
              readings: [
                { slot: 'gospel', ref: 'Lk 2:16-21', key: 'LK.2.16-21', linkout: 'https://example.org/1' },
                { slot: 'psalm', ref: 'Ps 67:2-3', key: 'PS.67.2-3', linkout: 'https://example.org/2' },
              ],
            },
          ],
        },
      ],
    };
    const context: CliContext = {
      ...harness.context,
      build: () => Promise.resolve({ calendar: withReadings, warnings: [] }),
    };
    expect(await runBuild(['--year', '2026'], context, harness.io)).toBe(0);
    expect(harness.out[0]).toContain('1 days, 2 readings, 0 lectionaryMissing');
  });

  it('prints usage without a year or with bad arguments', async () => {
    expect(await runBuild([], harness.context, harness.io)).toBe(2);
    expect(await runBuild(['--yaer', '2026'], harness.context, harness.io)).toBe(2);
    expect(harness.err).toEqual([
      'usage: calendar:build -- --year <YYYY> [--year <YYYY>]… [--region <slug>]',
      'unexpected argument "--yaer" "2026"\nusage: calendar:build -- --year <YYYY> [--year <YYYY>]… [--region <slug>]',
    ]);
    expect(harness.calls).toEqual([]);
  });

  it('stops at the first year that fails to build', async () => {
    harness.fail = new Error('bad data');
    expect(await runBuild(['--year', '2026', '--year', '2027'], harness.context, harness.io)).toBe(1);
    expect(harness.err).toEqual(['calendar:build 2026: bad data']);
    expect(harness.calls).toHaveLength(1);
  });
});

describe('committedYears and firstDifference', () => {
  it('lists the calendar year files only, ascending', async () => {
    write(2027, '{}');
    write(2026, '{}');
    writeFileSync(join(harness.root, 'calendar', 'notes.json'), '{}');
    mkdirSync(join(harness.root, 'calendar', 'lectionary'));
    expect(await committedYears(harness.root)).toEqual([2026, 2027]);
  });

  it('finds the first differing line', () => {
    expect(firstDifference('a\nb\n', 'a\nb\n')).toBeUndefined();
    expect(firstDifference('a\nb\nc', 'a\nx\nc')).toEqual({ line: 2, expected: 'b', actual: 'x' });
    expect(firstDifference('a\nb', 'a')).toEqual({ line: 2, expected: 'b', actual: '(end of file)' });
    expect(firstDifference('a', 'a\nb')).toEqual({ line: 2, expected: '(end of file)', actual: 'b' });
  });
});

describe('runCheck', () => {
  it('passes when every committed file matches a fresh build, rebuilding for the region each file names', async () => {
    write(2026, serialiseCalendar(calendarFor(2026, 'uganda')));
    write(2027, serialiseCalendar(calendarFor(2027, 'kenya')));
    expect(await runCheck([], harness.context, harness.io)).toBe(0);
    expect(harness.calls.map((c) => [c.year, c.region])).toEqual([
      [2026, 'uganda'],
      [2027, 'kenya'],
    ]);
    expect(harness.out).toEqual([
      'calendar/2026.json: up to date (1 days, 0 readings, 1 lectionaryMissing)',
      'calendar/2027.json: up to date (1 days, 0 readings, 1 lectionaryMissing)',
    ]);
    expect(harness.err).toEqual([]);
  });

  it('fails when a committed file is stale and shows the first difference', async () => {
    write(2026, serialiseCalendar(calendarFor(2026, 'kenya')));
    harness.generatedBy = 'fake 2';
    expect(await runCheck([], harness.context, harness.io)).toBe(1);
    expect(harness.err).toEqual([
      'calendar/2026.json: stale; run `npm run calendar:build -- --year 2026 --region kenya` and commit the result',
      '  first difference at line 4:',
      '    expected: "generatedBy": "fake 2",',
      '    committed: "generatedBy": "fake",',
      'calendar:check: 1 of 1 calendar file(s) need rebuilding',
    ]);
  });

  it('fails when a requested year has no file, using --region or else site.region', async () => {
    expect(await runCheck(['--year', '2030', '--region', 'uganda'], harness.context, harness.io)).toBe(1);
    expect(await runCheck(['--year', '2031'], harness.context, harness.io)).toBe(1);
    expect(harness.err).toEqual([
      'calendar/2030.json: missing; run `npm run calendar:build -- --year 2030 --region uganda`',
      'calendar:check: 1 of 1 calendar file(s) need rebuilding',
      `calendar/2031.json: missing; run \`npm run calendar:build -- --year 2031 --region ${DEFAULT_CONFIG.site.region}\``,
      'calendar:check: 1 of 1 calendar file(s) need rebuilding',
    ]);
  });

  it('treats an unreadable committed file as stale, rebuilt for site.region', async () => {
    write(2026, 'not json');
    write(2027, '{"region": "Not A Slug"}');
    expect(await runCheck([], harness.context, harness.io)).toBe(1);
    expect(harness.calls.map((c) => c.region)).toEqual([DEFAULT_CONFIG.site.region, DEFAULT_CONFIG.site.region]);
    expect(harness.err).toContain('    committed: not json');
  });

  it('reports a year that fails to build and carries on', async () => {
    write(2026, '{}');
    write(2027, '{}');
    harness.fail = new Error('bad data');
    expect(await runCheck([], harness.context, harness.io)).toBe(1);
    expect(harness.err).toEqual([
      'calendar/2026.json: build failed: bad data',
      'calendar/2027.json: build failed: bad data',
      'calendar:check: 2 of 2 calendar file(s) need rebuilding',
    ]);
  });

  it('fails without any calendar file, and on bad arguments', async () => {
    expect(await runCheck([], harness.context, harness.io)).toBe(1);
    expect(await runCheck(['--year'], harness.context, harness.io)).toBe(2);
    expect(harness.err).toEqual([
      'calendar:check: no calendar/<year>.json files to check',
      'unexpected argument "--year"\nusage: calendar:check [-- [--year <YYYY>]… [--region <slug>]]',
    ]);
  });
});

describe('processContext', () => {
  it('finds the repository and its config from INIT_CWD, else cwd', () => {
    const fromInit = processContext({ INIT_CWD: join(repoRoot, 'packages', 'calendar') }, '/');
    expect(fromInit.repoRoot).toBe(repoRoot.replace(/\/$/, ''));
    expect(fromInit.config.site.region).toBe('kenya');
    expect(fromInit.build).toBe(buildYear);
    expect(processContext({}, join(repoRoot, 'packages')).repoRoot).toBe(repoRoot.replace(/\/$/, ''));
  });
});

describe('the committed calendar files', () => {
  const committed = (year: number): CalendarYear =>
    JSON.parse(readFileSync(join(repoRoot, 'calendar', `${String(year)}.json`), 'utf8')) as CalendarYear;

  it('2026-09-20 has the four readings of the 25th Sunday (Year A) with drbo link-outs', () => {
    const day = committed(2026).days.find((d) => d.date === '2026-09-20');
    expect(day?.masses[0]?.readings.map((r) => [r.key, r.linkout])).toEqual([
      ['IS.55.6-9', 'https://www.drbo.org/chapter/27055.htm'],
      ['PS.145.2-3_145.8-9_145.17-18', 'https://www.drbo.org/chapter/21144.htm'],
      ['PHIL.1.20-24_1.27', 'https://www.drbo.org/chapter/57001.htm'],
      ['MT.20.1-16', 'https://www.drbo.org/chapter/47020.htm'],
    ]);
  });

  it('cover 2026 and 2027 for Kenya', () => {
    for (const year of [2026, 2027]) {
      expect(committed(year)).toMatchObject({ year, region: 'kenya' });
      expect(committed(year).days).toHaveLength(365);
    }
  });
});
