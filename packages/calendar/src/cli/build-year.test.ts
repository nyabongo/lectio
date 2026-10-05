import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '@lectio/config';
import { Lectionary } from '@lectio/lectionary';
import type { BlockFile, Reading as LectionaryReading } from '@lectio/lectionary';
import { RefError, VersificationError } from '@lectio/refs';
import { validateCalendarYear } from '@lectio/schema/calendar';
import type { CalendarYear } from '@lectio/schema/calendar';
import { afterAll, describe, expect, it } from 'vitest';

import { loadNameCatalog } from '../i18n/index.ts';
import type { CelebrationDetail, DetailedDay } from '../map.ts';
import {
  assembleDay,
  assembleYear,
  buildYear,
  calendarPath,
  calendarProblems,
  namingProblems,
  configLinkout,
  epiphanyDate,
  generatedBy,
  packageVersion,
  serialiseCalendar,
} from './build-year.ts';
import type { LinkoutFor } from './build-year.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const config = loadConfig(join(repoRoot, 'config', 'lectio.config.json'));
const names = loadNameCatalog(repoRoot);

function celebration(id: string, rank: CelebrationDetail['rank'], extra: Partial<CelebrationDetail> = {}) {
  return {
    id,
    name: `Name of ${id}`,
    rank,
    colour: 'green',
    romcalId: id.replaceAll('-', '_'),
    colours: ['green'],
    precedence: rank === 'sunday' ? 'SUNDAY_6' : 'WEEKDAY_13',
    optional: false,
    holyDayOfObligation: false,
    properCycle: 'proper-of-time',
    ...extra,
  } satisfies CelebrationDetail;
}

function day(date: string, celebrations: CelebrationDetail[], seasonWeek = 25): DetailedDay {
  return {
    date,
    season: 'ordinary-time',
    seasonWeek,
    sundayCycle: 'A',
    weekdayCycle: 'II',
    celebrations,
    masses: [],
    lectionaryMissing: true,
  };
}

const sunday = day('2026-09-20', [celebration('ordinary-time-25-sunday', 'sunday')]);
const monday = day('2026-09-21', [celebration('ordinary-time-25-monday', 'weekday')]);
const tuesday = day('2026-09-22', [celebration('ordinary-time-25-tuesday', 'weekday')]);
const wednesday = day('2026-09-23', [celebration('ordinary-time-25-wednesday', 'weekday')]);

function reading(slot: LectionaryReading['slot'], ref: string, printed?: string): LectionaryReading {
  return { slot, ref, ...(printed === undefined ? {} : { printed }), source: 'olm-1981 p?#1', status: 'provisional' };
}

const timeFile: BlockFile = {
  kind: 'proper-of-time',
  entries: [
    {
      key: 'ot-sunday-25',
      masses: [
        {
          id: 'day',
          readings: [
            reading('first-reading', 'Is 55:6-9', 'Isaiah 55:6-9'),
            reading('psalm', 'Ps 145:2-3, 8-9, 17-18'),
            reading('second-reading', 'Phil 1:20-24, 27', 'Philippians 1:20c-24, 27a'),
            reading('gospel', 'Mt 20:1-16', 'Matthew 20:1-16a'),
          ],
        },
      ],
    },
    {
      // Only a gospel: the first reading and psalm are missing.
      key: 'ot-weekday-25-mon',
      masses: [{ id: 'day', readings: [reading('gospel', 'Lk 8:16-18', 'not a citation')] }],
    },
    {
      key: 'ot-weekday-25-tue',
      masses: [
        {
          id: 'day',
          readings: [
            reading('first-reading', 'Est 4:17', 'Est 4:17n, p-r'),
            reading('psalm', 'Ps 138:1-2'),
            reading('gospel', 'Lk 8:19-21'),
          ],
        },
      ],
    },
  ],
};
const lectionary = new Lectionary([{ block: 'test', path: 'test/proper-of-time.json', data: timeFile }]);

const drbo: LinkoutFor = (key) => `https://example.org/${key}`;

describe('assembleYear', () => {
  const { calendar, warnings } = assembleYear({
    year: 2026,
    region: 'kenya',
    generatedBy: 'test',
    days: [wednesday, monday, sunday, tuesday],
    lectionary,
    linkout: drbo,
    names,
  });

  it('sorts the days and keeps the header fields', () => {
    expect(calendar.year).toBe(2026);
    expect(calendar.region).toBe('kenya');
    expect(calendar.generatedBy).toBe('test');
    expect(calendar.days.map((d) => d.date)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']);
    expect(validateCalendarYear(calendar)).toBe(true);
  });

  it('fills a day with data: printed citations, keys and link-outs, schema fields only', () => {
    const [first] = calendar.days;
    expect(first).toEqual({
      date: '2026-09-20',
      season: 'ordinary-time',
      seasonWeek: 25,
      sundayCycle: 'A',
      weekdayCycle: 'II',
      celebrations: [
        {
          id: 'ordinary-time-25-sunday',
          name: 'Name of ordinary-time-25-sunday',
          names: {
            en: 'Name of ordinary-time-25-sunday',
            sw: 'Dominika ya Ishirini na Tano ya Mwaka',
            swStatus: 'provisional',
          },
          rank: 'sunday',
          colour: 'green',
        },
      ],
      masses: [
        {
          id: 'day',
          label: 'Mass of the day',
          readings: [
            { slot: 'first-reading', ref: 'Isaiah 55:6-9', key: 'IS.55.6-9', linkout: 'https://example.org/IS.55.6-9' },
            {
              slot: 'psalm',
              ref: 'Ps 145:2-3, 8-9, 17-18',
              key: 'PS.145.2-3_145.8-9_145.17-18',
              linkout: 'https://example.org/PS.145.2-3_145.8-9_145.17-18',
            },
            {
              slot: 'second-reading',
              ref: 'Philippians 1:20c-24, 27a',
              key: 'PHIL.1.20-24_1.27',
              linkout: 'https://example.org/PHIL.1.20-24_1.27',
            },
            {
              slot: 'gospel',
              ref: 'Matthew 20:1-16a',
              key: 'MT.20.1-16',
              linkout: 'https://example.org/MT.20.1-16',
            },
          ],
        },
      ],
      lectionaryMissing: false,
    });
  });

  it('marks a day with missing slots as lectionaryMissing but keeps its readings', () => {
    const second = calendar.days[1];
    expect(second?.lectionaryMissing).toBe(true);
    expect(second?.masses[0]?.readings.map((r) => r.ref)).toEqual(['Lk 8:16-18']);
  });

  it('falls back to the canonical ref when the printed citation does not key to the reading', () => {
    expect(calendar.days[2]?.masses[0]?.readings[0]?.ref).toBe('Est 4:17');
    expect(calendar.days[2]?.lectionaryMissing).toBe(false);
    expect(warnings).toEqual([
      '2026-09-21 gospel LK.8.16-18: printed "not a citation" does not match the key; using "Lk 8:16-18"',
      '2026-09-22 first-reading EST.4.17: printed "Est 4:17n, p-r" does not match the key; using "Est 4:17"',
    ]);
  });

  it('gives a day without data no Masses and lectionaryMissing', () => {
    expect(calendar.days[3]).toMatchObject({ date: '2026-09-23', masses: [], lectionaryMissing: true });
  });
});

describe('assembleYear in the Christmas season', () => {
  const christmasDay = (date: string, id: string, rank: CelebrationDetail['rank']): DetailedDay => ({
    ...day(date, [celebration(id, rank, { colour: 'white', colours: ['white'] })], 0),
    season: 'christmas',
  });
  const gospels = (key: string, gospel: string) => ({
    key,
    masses: [
      {
        id: 'day',
        readings: [
          reading('first-reading', '1 Jn 3:22-4:6'),
          reading('psalm', 'Ps 2:7-8, 10-12'),
          reading('gospel', gospel),
        ],
      },
    ],
  });
  const seasonal = new Lectionary([
    {
      block: 'test',
      path: 'test/celebrations.json',
      data: {
        kind: 'celebrations',
        entries: [
          gospels('monday-after-epiphany', 'Mt 4:12-17, 23-25'),
          gospels('wednesday-after-epiphany', 'Mk 6:45-52'),
          {
            key: 'mary-mother-of-god',
            masses: [{ id: 'day', readings: [reading('psalm', 'Ps 67:2-3, 5, 6, 8', 'Psalm 66 (67): 2-3, 5, 6, 8')] }],
          },
        ],
      },
    },
  ]);
  const gospelOf7January = (epiphany: string) => {
    const days = [
      christmasDay(epiphany, 'epiphany-of-the-lord', 'solemnity'),
      christmasDay('2026-01-07', 'wednesday-after-epiphany', 'weekday'),
    ];
    expect(epiphanyDate(days)).toBe(epiphany);
    const { calendar } = assembleYear({
      year: 2026,
      region: 'x',
      generatedBy: 'test',
      days,
      lectionary: seasonal,
      linkout: drbo,
      names,
    });
    return calendar.days[1]?.masses[0]?.readings.at(-1)?.ref;
  };

  it('follows the Epiphany of the days: on 6 January, 7 January reads Monday’s readings; on a Sunday, its own', () => {
    expect(gospelOf7January('2026-01-06')).toBe('Mt 4:12-17, 23-25');
    expect(gospelOf7January('2026-01-04')).toBe('Mk 6:45-52');
    expect(epiphanyDate([monday])).toBeUndefined();
  });

  it('shows the canonical ref for a printed citation with a dual psalm number, which does not parse', () => {
    const warnings: string[] = [];
    const result = assembleDay(
      christmasDay('2026-01-01', 'mary-mother-of-god', 'solemnity'),
      seasonal,
      drbo,
      names,
      warnings,
    );
    expect(result.masses[0]?.readings[0]?.ref).toBe('Ps 67:2-3, 5, 6, 8');
    expect(warnings).toHaveLength(1);
  });
});

describe('assembleDay link-out failures', () => {
  it('leaves out a reading without a link-out, warns and marks the day', () => {
    const warnings: string[] = [];
    const linkout: LinkoutFor = (key) => {
      if (key.startsWith('PS.')) throw new VersificationError('NO_COUNTERPART', 'no Vulgate counterpart');
      return `https://example.org/${key}`;
    };
    const result = assembleDay(sunday, lectionary, linkout, names, warnings);
    expect(result.masses[0]?.readings.map((r) => r.slot)).toEqual(['first-reading', 'second-reading', 'gospel']);
    expect(result.lectionaryMissing).toBe(true);
    expect(warnings).toEqual([
      '2026-09-20 psalm PS.145.2-3_145.8-9_145.17-18: left out, no link-out (no Vulgate counterpart)',
    ]);
  });

  it('drops a Mass none of whose readings has a link-out', () => {
    const warnings: string[] = [];
    const result = assembleDay(
      monday,
      lectionary,
      () => {
        throw new VersificationError('UNKNOWN_VERSE', 'nope');
      },
      names,
      warnings,
    );
    expect(result.masses).toEqual([]);
    expect(result.lectionaryMissing).toBe(true);
  });

  it('rethrows any other error', () => {
    const boom: LinkoutFor = () => {
      throw new Error('misconfigured provider');
    };
    expect(() => assembleDay(sunday, lectionary, boom, names, [])).toThrow('misconfigured provider');
  });
});

function minimal(days: CalendarYear['days']): CalendarYear {
  return { year: 2026, region: 'kenya', generatedBy: 'test', days };
}

describe('calendarProblems', () => {
  const good = assembleYear({
    year: 2026,
    region: 'kenya',
    generatedBy: 'test',
    days: [sunday, monday],
    lectionary,
    linkout: drbo,
    names,
  }).calendar;

  it('accepts a valid calendar', () => {
    expect(calendarProblems(good)).toEqual([]);
  });

  it('reports schema errors', () => {
    expect(calendarProblems({ ...good, generatedBy: '' })).toContain(
      'schema: /generatedBy must NOT have fewer than 1 characters',
    );
    expect(calendarProblems(null as unknown as CalendarYear)).toEqual(['schema: / must be object']);
    expect(calendarProblems({ ...good, days: 'x' } as unknown as CalendarYear)[0]).toMatch(/^schema: \/days /);
  });

  it('reports dates outside the year, out of order or repeated', () => {
    const [a, b] = good.days as [CalendarYear['days'][number], CalendarYear['days'][number]];
    expect(calendarProblems(minimal([b, a]))).toEqual([
      '2026-09-20: not after 2026-09-21 (dates must be unique and sorted)',
    ]);
    expect(calendarProblems(minimal([a, a]))).toEqual([
      '2026-09-20: not after 2026-09-20 (dates must be unique and sorted)',
    ]);
    expect(calendarProblems(minimal([{ ...a, date: '2027-01-01' }]))).toEqual(['2027-01-01: outside 2026']);
  });

  it('reports a key that does not match its ref, or a ref that does not parse', () => {
    const [a] = good.days as [CalendarYear['days'][number]];
    const mass = a.masses[0] as CalendarYear['days'][number]['masses'][number];
    const withRefs = (...refs: string[]) =>
      minimal([
        {
          ...a,
          masses: [
            {
              ...mass,
              readings: refs.map((ref, i) => ({ ...(mass.readings[i] as (typeof mass.readings)[number]), ref })),
            },
          ],
        },
      ]);
    const problems = calendarProblems(withRefs('Is 55:6-10', 'Nowhere 1:1'));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toBe('2026-09-20 day first-reading: key IS.55.6-9 does not match ref "Is 55:6-10"');
    expect(problems[1]).toMatch(
      /^2026-09-20 day psalm: key PS\.145\.2-3_145\.8-9_145\.17-18 does not match ref "Nowhere 1:1"$/,
    );
  });
});

describe('helpers', () => {
  it('serialises with two spaces, LF and a final newline', () => {
    const text = serialiseCalendar(minimal([]));
    expect(text).toBe('{\n  "year": 2026,\n  "region": "kenya",\n  "generatedBy": "test",\n  "days": []\n}\n');
  });

  it('names the package and romcal versions', () => {
    expect(generatedBy('1.2.3', '3.0.0')).toBe('@lectio/calendar 1.2.3 (romcal 3.0.0)');
    expect(generatedBy('1.2.3')).toMatch(/^@lectio\/calendar 1\.2\.3 \(romcal 3\.\d+\.\d+.*\)$/);
    expect(packageVersion()).toBe(
      (JSON.parse(readFileSync(join(repoRoot, 'packages/calendar/package.json'), 'utf8')) as { version: string })
        .version,
    );
  });

  it('builds link-outs from the config provider', () => {
    expect(configLinkout(config)('PS.145.2-3', '2026-09-20')).toBe('https://www.drbo.org/chapter/21144.htm');
    expect(() => configLinkout(config)('not a key', '2026-09-20')).toThrow(RefError);
  });

  it('places calendar files under calendar/', () => {
    expect(calendarPath('/repo', 2026)).toBe('/repo/calendar/2026.json');
  });
});

describe('namingProblems', () => {
  it('accepts celebrations named in calendar/i18n/sw.json', () => {
    const { calendar } = assembleYear({
      year: 2026,
      region: 'kenya',
      generatedBy: 'test',
      days: [sunday, monday],
      lectionary,
      linkout: drbo,
      names,
    });
    expect(namingProblems(calendar, names)).toEqual([]);
  });

  it('reports each celebration id without an entry once', () => {
    const celebration = { id: 'saint-nobody', name: 'Saint Nobody', rank: 'memorial', colour: 'white' } as const;
    const day = {
      date: '2026-09-21',
      season: 'ordinary-time',
      seasonWeek: 25,
      sundayCycle: 'A',
      weekdayCycle: 'II',
    } as const;
    const calendar = minimal([
      { ...day, celebrations: [celebration], masses: [], lectionaryMissing: true },
      { ...day, date: '2026-09-22', celebrations: [celebration], masses: [], lectionaryMissing: true },
    ]);
    expect(namingProblems(calendar, names)).toEqual([
      'saint-nobody: no entry in calendar/i18n/sw.json (add a Kiswahili name, or a "fallback" entry with name null)',
    ]);
  });
});

// Each test runs romcal over a whole year; give it room on a loaded CI runner.
describe('buildYear', { timeout: 60_000 }, () => {
  const temps: string[] = [];
  afterAll(() => {
    for (const dir of temps) rmSync(dir, { recursive: true, force: true });
  });

  it('builds 2026 for Kenya from the repository', async () => {
    const { calendar } = await buildYear({ repoRoot, year: 2026, region: 'kenya', config });
    expect(calendar.days).toHaveLength(365);
    expect(calendar.generatedBy).toBe(generatedBy(packageVersion()));
    expect(calendarProblems(calendar)).toEqual([]);
    const sept20 = calendar.days.find((d) => d.date === '2026-09-20');
    expect(sept20?.lectionaryMissing).toBe(false);
    expect(sept20?.celebrations[0]?.names).toEqual({
      en: 'Twenty-fifth Sunday in Ordinary Time',
      sw: 'Dominika ya Ishirini na Tano ya Mwaka',
      swStatus: 'provisional',
    });
    expect(sept20?.masses[0]?.readings.map((r) => [r.key, r.linkout])).toEqual([
      ['IS.55.6-9', 'https://www.drbo.org/chapter/27055.htm'],
      ['PS.145.2-3_145.8-9_145.17-18', 'https://www.drbo.org/chapter/21144.htm'],
      ['PHIL.1.20-24_1.27', 'https://www.drbo.org/chapter/57001.htm'],
      ['MT.20.1-16', 'https://www.drbo.org/chapter/47020.htm'],
    ]);
  });

  it('refuses invalid lectionary data', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lectio-calendar-'));
    temps.push(root);
    cpSync(join(repoRoot, 'calendar', 'overrides'), join(root, 'calendar', 'overrides'), { recursive: true });
    cpSync(
      join(repoRoot, 'calendar', 'lectionary', 'sources.json'),
      join(root, 'calendar', 'lectionary', 'sources.json'),
    );
    cpSync(join(repoRoot, 'calendar', 'lectionary', 'seed'), join(root, 'calendar', 'lectionary', 'seed'), {
      recursive: true,
    });
    writeFileSync(join(root, 'calendar', 'lectionary', 'seed', 'broken.json'), '{');
    await expect(buildYear({ repoRoot: root, year: 2026, region: 'kenya', config })).rejects.toThrow(
      /^calendar\/lectionary has problems \(run npm run lectionary:check\):\n {2}seed\/broken\.json: /,
    );
  });

  it('refuses a year with a celebration that has no entry in the name catalog', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lectio-calendar-'));
    temps.push(root);
    for (const dir of ['overrides', 'lectionary']) {
      cpSync(join(repoRoot, 'calendar', dir), join(root, 'calendar', dir), { recursive: true });
    }
    const catalog = JSON.parse(readFileSync(join(repoRoot, 'calendar', 'i18n', 'sw.json'), 'utf8')) as {
      celebrations: Record<string, unknown>;
    };
    delete catalog.celebrations['ordinary-time-25-sunday'];
    mkdirSync(join(root, 'calendar', 'i18n'));
    writeFileSync(join(root, 'calendar', 'i18n', 'sw.json'), JSON.stringify(catalog));
    await expect(buildYear({ repoRoot: root, year: 2026, region: 'kenya', config })).rejects.toThrow(
      'calendar 2026 is invalid:\n  ordinary-time-25-sunday: no entry in calendar/i18n/sw.json',
    );
  });

  it('refuses an invalid name catalog', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lectio-calendar-'));
    temps.push(root);
    for (const dir of ['overrides', 'lectionary']) {
      cpSync(join(repoRoot, 'calendar', dir), join(root, 'calendar', dir), { recursive: true });
    }
    mkdirSync(join(root, 'calendar', 'i18n'));
    writeFileSync(join(root, 'calendar', 'i18n', 'sw.json'), '{"locale": "sw"}');
    await expect(buildYear({ repoRoot: root, year: 2026, region: 'kenya', config })).rejects.toThrow(
      /^Invalid calendar\/i18n\/sw\.json:\n {2}language: /,
    );
  });

  it('refuses a result that fails validation', async () => {
    await expect(buildYear({ repoRoot, year: 2026, region: 'kenya', config, generatedBy: '' })).rejects.toThrow(
      /^calendar 2026 is invalid:\n {2}schema: \/generatedBy/,
    );
  });
});
