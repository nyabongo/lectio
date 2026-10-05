import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { validateCalendarYear } from '@lectio/schema/calendar';
import { describe, expect, it } from 'vitest';

import romcalIds from '../fixtures/romcal-ids.json' with { type: 'json' };
import { toCalendarDay } from '../map.ts';
import type { DetailedDay, RomcalDayInput } from '../map.ts';
import type { ApplyResult } from './apply.ts';
import { baseDays, generateRegionalDays, loadOverrides, overridesPath, transferOptions } from './region.ts';
import { pendingSignOff } from './schema.ts';
import type { RegionalOverrides } from './schema.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const kenyaPath = overridesPath(repoRoot, 'kenya');
const kenya = await loadOverrides(kenyaPath);

const years = new Map<number, ApplyResult>();
for (const year of [2025, 2026, 2027]) years.set(year, await generateRegionalDays(year, kenya));

function day(date: string): DetailedDay {
  const found = years.get(Number(date.slice(0, 4)))?.days.find((d) => d.date === date);
  if (!found) throw new Error(`no ${date}`);
  return found;
}
const ids = (date: string): string[] => day(date).celebrations.map((c) => c.id);
const ranks = (date: string): [string, string][] => day(date).celebrations.map((c) => [c.id, c.rank]);

describe('overridesPath and loadOverrides', () => {
  it('finds calendar/overrides/<region>.json under the repository root', () => {
    expect(overridesPath('/repo', 'kenya')).toBe('/repo/calendar/overrides/kenya.json');
  });

  it('loads and validates the Kenya file', () => {
    expect(kenya.region).toBe('kenya');
    expect(kenya.entries.length).toBeGreaterThan(0);
  });

  it('rejects an invalid file', async () => {
    const path = fileURLToPath(new URL('../fixtures/romcal-ids.json', import.meta.url));
    await expect(loadOverrides(path)).rejects.toThrow('Invalid regional overrides');
  });
});

describe('calendar/overrides/kenya.json', () => {
  const raw = JSON.parse(readFileSync(kenyaPath, 'utf8')) as RegionalOverrides;
  const lectioIds = new Set(Object.values(romcalIds as Record<string, string>));

  it('cites a source for every entry and transfer', () => {
    const cited = [...Object.values(raw.transfers), ...raw.entries];
    expect(cited.length).toBe(Object.keys(raw.transfers).length + raw.entries.length);
    for (const item of cited) {
      expect(item?.source.url).toMatch(/^https:\/\//);
      expect(item?.source.title.length).toBeGreaterThan(0);
    }
  });

  it('adds only new ids and changes only ids romcal knows', () => {
    for (const entry of raw.entries) {
      if (entry.action === 'add') expect(lectioIds.has(entry.id), entry.id).toBe(false);
      else expect(lectioIds.has(entry.id), entry.id).toBe(true);
    }
  });

  it('lists the unconfirmed entries for the L-209 sign-off', () => {
    // Nothing has been checked against the KCCB Ordo yet, so everything waits for sign-off.
    expect(pendingSignOff(kenya)).toHaveLength(Object.keys(raw.transfers).length + raw.entries.length);
  });

  it('sets the three transfer flags', () => {
    expect(transferOptions(kenya)).toEqual({
      epiphanyOnSunday: true,
      ascensionOnSunday: true,
      corpusChristiOnSunday: true,
    });
  });
});

describe('transferOptions', () => {
  it('leaves out flags the region does not set', () => {
    expect(transferOptions({ ...kenya, transfers: {} })).toEqual({});
  });
});

describe('baseDays', () => {
  const weekday: RomcalDayInput = {
    id: 'ordinary_time_9_wednesday',
    date: '2026-06-03',
    name: 'Wednesday of the ninth week of Ordinary Time',
    rank: 'WEEKDAY',
    precedence: 'WEEKDAY_13',
    colors: ['GREEN'],
    seasons: ['ORDINARY_TIME'],
    isOptional: false,
    isHolyDayOfObligation: false,
    calendar: { weekOfSeason: 9 },
    cycles: { properCycle: 'PROPER_OF_TIME', sundayCycle: 'YEAR_A', weekdayCycle: 'YEAR_2' },
  };
  const memorial: RomcalDayInput = {
    ...weekday,
    id: 'charles_lwanga_and_companions_martyrs',
    name: 'Saints Charles Lwanga and Companions, Martyrs',
    rank: 'MEMORIAL',
    precedence: 'GENERAL_MEMORIAL_10',
    colors: ['RED'],
    cycles: { ...weekday.cycles, properCycle: 'PROPER_OF_SAINTS' },
    weekday,
  };
  const days = ['2026-06-03', '2026-06-04', '2026-06-05'].map(
    (date) => ({ date, season: 'ordinary-time' }) as unknown as DetailedDay,
  );

  it('takes the weekday entry, or the weekday under a celebration, and skips days without one', () => {
    const bases = baseDays(
      {
        '2026-06-03': [memorial],
        '2026-06-04': [{ ...weekday, id: 'ordinary_time_9_thursday', date: '2026-06-04' }],
        '2026-06-05': [{ ...memorial, weekday: undefined }],
      },
      days,
    );
    expect(bases.get('2026-06-03')?.id).toBe('ordinary-time-9-wednesday');
    expect(bases.get('2026-06-04')?.id).toBe('ordinary-time-9-thursday');
    expect(bases.has('2026-06-05')).toBe(false);
  });

  it('skips dates romcal did not return', () => {
    expect(baseDays({}, days).size).toBe(0);
  });
});

describe('generateRegionalDays', () => {
  it('rejects years outside the schema range', async () => {
    await expect(generateRegionalDays(1969, kenya)).rejects.toThrow(RangeError);
    await expect(generateRegionalDays(2026.5, kenya)).rejects.toThrow('year must be an integer from 1970 to 9999');
  });

  it('applies a removal with the weekday romcal puts under the celebration', async () => {
    const source = kenya.entries[0]?.source;
    if (!source) throw new Error('no source');
    const { days, events } = await generateRegionalDays(2026, {
      region: 'test',
      description: 'Test overrides',
      transfers: {},
      entries: [{ action: 'remove', id: 'charles-lwanga-and-companions-martyrs', source, confidence: 'uncertain' }],
    });
    expect(days.find((d) => d.date === '2026-06-03')?.celebrations.map((c) => [c.id, c.name, c.colour])).toEqual([
      ['ordinary-time-9-wednesday', 'Wednesday of the ninth week of Ordinary Time', 'green'],
    ]);
    expect(days.find((d) => d.date === '2026-05-14')?.celebrations[0]?.id).toBe('ascension-of-the-lord');
    expect(events).toEqual([{ id: 'charles-lwanga-and-companions-martyrs', outcome: 'removed', date: '2026-06-03' }]);
  });

  it('produces days that validate against the calendar schema', () => {
    for (const [year, result] of years) {
      expect(result.days).toHaveLength(365);
      const file = { year, region: 'kenya', generatedBy: 'test', days: result.days.map(toCalendarDay) };
      expect(validateCalendarYear(file), JSON.stringify(validateCalendarYear.errors)).toBe(true);
    }
  });
});

/**
 * The Kenya calendar compared with GCatholic.org's Kenya calendars for 2025–2027 (the source
 * cited in kenya.json): every difference from the General Roman Calendar listed there.
 */
describe('Kenya calendar (matches GCatholic.org, 2025-2027)', () => {
  it('Epiphany, Ascension and Corpus Christi on Sunday', () => {
    expect(ids('2026-01-04')).toEqual(['epiphany-of-the-lord']);
    expect(ids('2026-01-06')).toEqual(['tuesday-after-epiphany']);
    expect(ids('2026-05-17')).toEqual(['ascension-of-the-lord']);
    expect(ids('2026-05-14')).toEqual(['matthias-apostle']);
    expect(ids('2026-06-07')).toEqual(['most-holy-body-and-blood-of-christ']);
    expect(ids('2025-06-01')).toEqual(['ascension-of-the-lord']);
    expect(ids('2027-01-03')).toEqual(['epiphany-of-the-lord']);
  });

  it('Our Lady Mother of Africa (feast, 30 April) with St Pius V on 28 April', () => {
    for (const year of [2025, 2026, 2027]) {
      expect(ranks(`${String(year)}-04-30`)).toEqual([['our-lady-mother-of-africa', 'feast']]);
      expect(ids(`${String(year)}-04-28`)).toContain('pius-v-pope');
    }
    expect(day('2026-04-30').celebrations[0]).toMatchObject({ colour: 'white', weekdayId: 'easter-time-4-thursday' });
  });

  it('obligatory memorials: Comboni, All Saints of Africa, Our Lady Help of Christians', () => {
    expect(ranks('2026-10-10')).toEqual([['daniel-comboni-bishop', 'memorial']]);
    expect(ranks('2025-10-10')).toEqual([['daniel-comboni-bishop', 'memorial']]);
    expect(ids('2027-10-10')).toEqual(['ordinary-time-28-sunday']);
    expect(ranks('2026-11-06')).toEqual([['all-saints-of-africa', 'memorial']]);
    expect(ranks('2025-05-24')).toEqual([['our-lady-help-of-christians', 'memorial']]);
    expect(ranks('2027-05-24')).toEqual([['our-lady-help-of-christians', 'memorial']]);
    expect(ids('2026-05-24')).toEqual(['pentecost-sunday']);
  });

  it('optional memorials of African saints, as commemorations in Lent and omitted on higher days', () => {
    const expected: [string, string][] = [
      ['2026-01-09', 'adrian-of-canterbury-abbot'],
      ['2026-01-20', 'cyprian-michael-tansi-priest'],
      ['2025-02-26', 'alexander-of-alexandria-bishop'],
      ['2026-04-20', 'marcellinus-of-embrun-bishop'],
      ['2027-04-12', 'zeno-of-verona-bishop'],
      ['2025-06-12', 'onuphrius-abbot'],
      ['2026-07-28', 'victor-i-pope'],
      ['2026-07-30', 'justin-de-jacobis-bishop'],
      ['2026-08-12', 'isidore-bakanja-martyr'],
      ['2026-08-18', 'victoria-rasoamanarivo'],
      ['2026-09-22', 'maurice-of-agaune-and-companions-martyrs'],
      ['2026-10-20', 'daudi-okelo-and-jildo-irwa-martyrs'],
      ['2026-12-01', 'marie-clementine-anuarite-nengapeta-virgin-and-martyr'],
    ];
    for (const [date, id] of expected) expect(ranks(date), date).toContainEqual([id, 'optional-memorial']);
    expect(ranks('2026-02-26')).toContainEqual(['alexander-of-alexandria-bishop', 'commemoration']);
    expect(ranks('2025-04-04')).toContainEqual(['benedict-the-moor-religious', 'commemoration']);
    expect(ranks('2025-04-12')).toContainEqual(['zeno-of-verona-bishop', 'commemoration']);
    expect(ids('2026-04-04')).toEqual(['holy-saturday']);
    expect(ids('2025-04-20')).toEqual(['easter-sunday']);
  });

  it('keeps the coinciding-memorials rule on 2026-06-13 with level-12 precedence', () => {
    expect(day('2026-06-13').celebrations.map((c) => [c.id, c.rank, c.precedence])).toEqual([
      ['ordinary-time-10-saturday', 'weekday', 'WEEKDAY_13'],
      ['immaculate-heart-of-mary', 'optional-memorial', 'OPTIONAL_MEMORIAL_12'],
      ['anthony-of-padua-priest', 'optional-memorial', 'OPTIONAL_MEMORIAL_12'],
    ]);
  });

  it('reports what each override did', () => {
    const events = years.get(2026)?.events ?? [];
    expect(events).toContainEqual({ id: 'our-lady-help-of-christians', outcome: 'impeded', date: '2026-05-24' });
    expect(events).toContainEqual({
      id: 'alexander-of-alexandria-bishop',
      outcome: 'commemorated',
      date: '2026-02-26',
    });
    expect(events.some((e) => e.outcome === 'not-found')).toBe(false);
  });
});
