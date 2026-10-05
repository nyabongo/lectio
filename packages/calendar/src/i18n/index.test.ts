import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SEASONS } from '@lectio/schema/calendar';
import type { CalendarYear } from '@lectio/schema/calendar';
import { LITURGICAL_COLOURS } from '@lectio/schema/common';
import { describe, expect, it } from 'vitest';

import * as calendar from '../index.ts';
import romcalIds from '../fixtures/romcal-ids.json' with { type: 'json' };
import type { NameCatalog } from './catalog.ts';
import {
  CALENDAR_LOCALES,
  ENGLISH_COLOUR_NAMES,
  ENGLISH_SEASON_NAMES,
  SWAHILI,
  celebrationName,
  celebrationNameIn,
  celebrationNames,
  colourName,
  seasonName,
  unnamedCelebrations,
} from './index.ts';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/** Every id an override file names (added, removed, re-ranked or moved). */
function overrideIds(): string[] {
  const dir = join(repoRoot, 'calendar', 'overrides');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => (readJson(join(dir, name)) as { entries: { id: string }[] }).entries.map((e) => e.id));
}

/** The committed calendar files. */
function committedCalendars(): CalendarYear[] {
  const dir = join(repoRoot, 'calendar');
  return readdirSync(dir)
    .filter((name) => /^\d{4}\.json$/.test(name))
    .map((name) => readJson(join(dir, name)) as CalendarYear);
}

const knownIds = new Set([...Object.values(romcalIds as Record<string, string>), ...overrideIds()]);

describe('calendar/i18n/sw.json', () => {
  it('is a valid Kiswahili catalog', () => {
    expect(SWAHILI.locale).toBe('sw');
    expect(SWAHILI.language).toBe('Kiswahili');
  });

  it('has a Kiswahili name or an explicit fallback for every celebration id romcal and the overrides can produce', () => {
    expect(unnamedCelebrations(knownIds)).toEqual([]);
  });

  it('has an entry for every celebration in the committed calendars', () => {
    const ids = committedCalendars().flatMap((year) => year.days.flatMap((d) => d.celebrations.map((c) => c.id)));
    expect(ids.length).toBeGreaterThan(0);
    expect(unnamedCelebrations(ids)).toEqual([]);
  });

  it('names only known celebration ids (no typos, no stale ids)', () => {
    expect(Object.keys(SWAHILI.celebrations).filter((id) => !knownIds.has(id))).toEqual([]);
  });

  it('names every season and colour', () => {
    for (const season of SEASONS) expect(SWAHILI.seasons[season].name).toBeTruthy();
    for (const colour of LITURGICAL_COLOURS) expect(SWAHILI.colours[colour].name).toBeTruthy();
  });

  it('matches the names written into the committed calendars', () => {
    for (const year of committedCalendars()) {
      for (const day of year.days) {
        for (const c of day.celebrations) expect(c.names).toEqual(celebrationNames(c.id, c.name));
      }
    }
  });
});

/** A catalog with one named and one fallback entry of each kind. */
const fake: NameCatalog = {
  locale: 'sw',
  language: 'Kiswahili',
  seasons: { ...SWAHILI.seasons, lent: { name: null, status: 'fallback' } },
  colours: { ...SWAHILI.colours, gold: { name: null, status: 'fallback' } },
  celebrations: {
    'easter-sunday': { name: 'Pasaka', status: 'reviewed' },
    'saint-nobody': { name: null, status: 'fallback', note: 'no established name' },
  },
};

describe('celebrationName and celebrationNames', () => {
  it('gives the Kiswahili name with its status', () => {
    expect(celebrationName('easter-sunday', 'Easter Sunday', fake)).toEqual({ name: 'Pasaka', status: 'reviewed' });
    expect(celebrationName('ordinary-time-25-sunday', 'Twenty-fifth Sunday in Ordinary Time')).toEqual({
      name: 'Dominika ya Ishirini na Tano ya Mwaka',
      status: 'provisional',
    });
  });

  it('falls back to the English name for a flagged fallback, a missing id or an inherited key', () => {
    expect(celebrationName('saint-nobody', 'Saint Nobody', fake)).toEqual({ name: 'Saint Nobody', status: 'fallback' });
    expect(celebrationName('unknown-id', 'Unknown', fake)).toEqual({ name: 'Unknown', status: 'fallback' });
    expect(celebrationName('constructor', 'Constructor', fake)).toEqual({ name: 'Constructor', status: 'fallback' });
  });

  it('pairs both languages', () => {
    expect(celebrationNames('easter-sunday', 'Easter Sunday', fake)).toEqual({ en: 'Easter Sunday', sw: 'Pasaka' });
    expect(celebrationNames('saint-nobody', 'Saint Nobody', fake)).toEqual({ en: 'Saint Nobody', sw: 'Saint Nobody' });
    expect(celebrationNames('nativity-of-the-lord', 'The Nativity of the Lord (Christmas)')).toEqual({
      en: 'The Nativity of the Lord (Christmas)',
      sw: 'Kuzaliwa kwa Bwana (Noeli)',
    });
  });
});

describe('celebrationNameIn', () => {
  it('gives the translated name, or undefined so the caller keeps the calendar name', () => {
    expect(celebrationNameIn('sw', 'ordinary-time-25-sunday')).toBe('Dominika ya Ishirini na Tano ya Mwaka');
    expect(celebrationNameIn('sw', 'easter-sunday', fake)).toBe('Pasaka');
    expect(celebrationNameIn('en', 'easter-sunday', fake)).toBeUndefined();
    expect(celebrationNameIn('sw', 'saint-nobody', fake)).toBeUndefined();
    expect(celebrationNameIn('sw', 'unknown-id', fake)).toBeUndefined();
    expect(celebrationNameIn('sw', 'constructor', fake)).toBeUndefined();
  });
});

describe('seasonName and colourName', () => {
  it('give English by default and Kiswahili on request', () => {
    expect(CALENDAR_LOCALES).toEqual(['en', 'sw']);
    expect(seasonName('advent')).toBe('Advent');
    expect(seasonName('advent', 'sw')).toBe('Majilio');
    expect(colourName('violet')).toBe('Violet');
    expect(colourName('violet', 'sw')).toBe('Zambarau');
  });

  it('fall back to English for a flagged fallback', () => {
    expect(seasonName('lent', 'sw', fake)).toBe('Lent');
    expect(colourName('gold', 'sw', fake)).toBe('Gold');
  });

  it('name every season and colour in both languages', () => {
    for (const season of SEASONS) {
      expect(seasonName(season, 'en')).toBe(ENGLISH_SEASON_NAMES[season]);
      expect(seasonName(season, 'sw')).not.toBe(ENGLISH_SEASON_NAMES[season]);
    }
    for (const colour of LITURGICAL_COLOURS) {
      expect(colourName(colour, 'en')).toBe(ENGLISH_COLOUR_NAMES[colour]);
      expect(colourName(colour, 'sw')).not.toBe(ENGLISH_COLOUR_NAMES[colour]);
    }
  });
});

describe('unnamedCelebrations', () => {
  it('lists ids without any entry once, sorted; fallbacks count as named', () => {
    expect(unnamedCelebrations(['b-id', 'saint-nobody', 'a-id', 'b-id', 'easter-sunday'], fake)).toEqual([
      'a-id',
      'b-id',
    ]);
  });
});

describe('package exports', () => {
  it('exports the naming API from @lectio/calendar', () => {
    expect(calendar.SWAHILI).toBe(SWAHILI);
    expect(calendar.celebrationNames).toBe(celebrationNames);
    expect(calendar.seasonName).toBe(seasonName);
    expect(calendar.colourName).toBe(colourName);
    expect(calendar.parseNameCatalog).toBeTypeOf('function');
  });
});
