import { describe, expect, it } from 'vitest';

import {
  INTL_LOCALES,
  buildCatalogs,
  flattenCatalog,
  formatDate,
  intlLocale,
  localePath,
  parseCatalogPath,
  translate,
} from './i18n.ts';

const catalogs = buildCatalogs(
  {
    './en/common.json': { nav: { calendar: 'Calendar' }, greeting: 'Hello, {name}' },
    './en/day.json': {
      title: 'Today',
      notes: { one: '{count} note', other: '{count} notes' },
      words: { zero: 'no words', one: 'one word', other: '{count} words' },
      items: { zero: 'no items', other: '{count} items' },
    },
    './sw/common.json': { nav: { calendar: 'Kalenda' } },
  },
  'en',
);

describe('parseCatalogPath', () => {
  it('reads the locale and feature from glob and plain paths', () => {
    expect(parseCatalogPath('./en/common.json')).toEqual({ locale: 'en', feature: 'common' });
    expect(parseCatalogPath('sw/day-notes.json')).toEqual({ locale: 'sw', feature: 'day-notes' });
    expect(parseCatalogPath('/abs/src/i18n/en/a.b.json')).toEqual({ locale: 'en', feature: 'a.b' });
  });

  it('rejects paths that are not <locale>/<feature>.json', () => {
    expect(() => parseCatalogPath('common.json')).toThrow(/<locale>\/<feature>\.json/);
    expect(() => parseCatalogPath('./en/common.yaml')).toThrow(/<locale>\/<feature>\.json/);
    expect(() => parseCatalogPath('./en/bad name.json')).toThrow(/feature name/);
    expect(() => parseCatalogPath('./en/a..b.json')).toThrow(/feature name/);
  });
});

describe('flattenCatalog', () => {
  it('flattens nested objects into dotted keys and keeps plural messages whole', () => {
    expect(flattenCatalog({ a: { b: 'x' }, n: { one: '1', other: 'n' } }, 'f', 'p')).toEqual([
      ['f.a.b', 'x'],
      ['f.n', { one: '1', other: 'n' }],
    ]);
  });

  it('treats a lone `other`, or plural keys without `one` or `other`, as nesting', () => {
    expect(flattenCatalog({ links: { other: 'Other links' } }, 'f', 'p')).toEqual([['f.links.other', 'Other links']]);
    expect(flattenCatalog({ zero: 'a', two: 'b' }, 'f', 'p')).toEqual([
      ['f.zero', 'a'],
      ['f.two', 'b'],
    ]);
  });

  it('treats an object mixing plural and other keys, or with non-string forms, as nesting', () => {
    expect(flattenCatalog({ one: 'a', other: 'b', title: 'c' }, 'f', 'p')).toHaveLength(3);
    expect(flattenCatalog({ one: 'a', other: { x: 'b' } }, 'f', 'p')).toEqual([
      ['f.one', 'a'],
      ['f.other.x', 'b'],
    ]);
  });

  it('requires an `other` form on a plural message', () => {
    expect(() => flattenCatalog({ n: { one: 'a', few: 'b' } }, 'f', 'en/f.json')).toThrow(
      'en/f.json: plural message "f.n" needs an "other" form',
    );
  });

  it('rejects arrays, numbers, nulls, empty objects and odd keys', () => {
    expect(() => flattenCatalog({ a: ['x'] }, 'f', 'en/f.json')).toThrow(
      'en/f.json: "f.a" must be a string or an object',
    );
    expect(() => flattenCatalog({ a: 1 }, 'f', 'p')).toThrow(/"f.a" must be/);
    expect(() => flattenCatalog(null, 'f', 'p')).toThrow(/"f" must be/);
    expect(() => flattenCatalog({ a: {} }, 'f', 'p')).toThrow(/"f.a" is an empty object/);
    expect(() => flattenCatalog({ 'a.b': 'x' }, 'f', 'p')).toThrow(/key "a.b" under "f"/);
  });
});

describe('buildCatalogs', () => {
  it('namespaces keys by file and groups them by locale', () => {
    expect(catalogs.defaultLocale).toBe('en');
    expect([...catalogs.locales.keys()]).toEqual(['en', 'sw']);
    expect(catalogs.locales.get('en')?.get('common.nav.calendar')).toBe('Calendar');
    expect(catalogs.locales.get('en')?.get('day.title')).toBe('Today');
    expect(catalogs.sources.get('sw:common.nav.calendar')).toBe('./sw/common.json');
  });

  it('keeps a top-level `default` key as an ordinary key', () => {
    const settings = buildCatalogs({ './en/settings.json': { default: 'Default', dark: 'Dark' } }, 'en');
    expect([...(settings.locales.get('en') ?? new Map()).entries()]).toEqual([
      ['settings.default', 'Default'],
      ['settings.dark', 'Dark'],
    ]);
    expect(translate(settings, 'en', 'settings.default')).toBe('Default');
    expect(translate(settings, 'en', 'settings.dark')).toBe('Dark');
  });

  it('throws when two files define the same key', () => {
    expect(() =>
      buildCatalogs({ './en/day.json': { extra: { x: 'a' } }, './en/day.extra.json': { x: 'b' } }, 'en'),
    ).toThrow('key "day.extra.x" (en) is defined in both ./en/day.extra.json and ./en/day.json');
  });

  it('allows the same key in different locales', () => {
    expect(() => buildCatalogs({ './en/a.json': { x: 'a' }, './sw/a.json': { x: 'b' } }, 'en')).not.toThrow();
  });
});

describe('translate', () => {
  it('returns the message for the locale', () => {
    expect(translate(catalogs, 'en', 'common.nav.calendar')).toBe('Calendar');
    expect(translate(catalogs, 'sw', 'common.nav.calendar')).toBe('Kalenda');
  });

  it('falls back to the default locale for untranslated keys and unknown locales', () => {
    expect(translate(catalogs, 'sw', 'day.title')).toBe('Today');
    expect(translate(catalogs, 'fr', 'day.title')).toBe('Today');
  });

  it('falls back to whichever locale the catalogs name as default', () => {
    const swFirst = buildCatalogs({ './sw/a.json': { x: 'Habari' }, './en/a.json': { y: 'Hello' } }, 'sw');
    expect(translate(swFirst, 'en', 'a.x')).toBe('Habari');
    expect(() => translate(swFirst, 'sw', 'a.y')).toThrow('unknown message key "a.y" (sw)');
  });

  it('fills placeholders, formatting numbers for the locale', () => {
    expect(translate(catalogs, 'en', 'common.greeting', { name: 'Ada' })).toBe('Hello, Ada');
    expect(translate(catalogs, 'en', 'common.greeting', { name: 1234 })).toBe('Hello, 1,234');
  });

  it('picks the plural form with Intl.PluralRules', () => {
    expect(translate(catalogs, 'en', 'day.notes', { count: 1 })).toBe('1 note');
    expect(translate(catalogs, 'en', 'day.notes', { count: 0 })).toBe('0 notes');
    expect(translate(catalogs, 'en', 'day.notes', { count: 2500 })).toBe('2,500 notes');
    // English never selects `zero`, so 0 uses `other`.
    expect(translate(catalogs, 'en', 'day.words', { count: 0 })).toBe('0 words');
    expect(translate(catalogs, 'en', 'day.words', { count: 1 })).toBe('one word');
    // A form the message lacks (`one` here) falls back to `other`.
    expect(translate(catalogs, 'en', 'day.items', { count: 1 })).toBe('1 items');
  });

  it('throws on unknown keys, missing parameters and plural messages without a count', () => {
    expect(() => translate(catalogs, 'en', 'nope.key')).toThrow('unknown message key "nope.key" (en)');
    expect(() => translate(catalogs, 'en', 'common.greeting')).toThrow(
      'message "common.greeting" needs the parameter "name"',
    );
    expect(() => translate(catalogs, 'en', 'day.notes')).toThrow(/needs a numeric "count"/);
    expect(() => translate(catalogs, 'en', 'day.notes', { count: '2' })).toThrow(/needs a numeric "count"/);
  });
});

describe('intlLocale', () => {
  it('maps site locales through the table and passes others through', () => {
    expect(INTL_LOCALES).toEqual({ en: 'en-GB', sw: 'sw-KE' });
    expect(intlLocale('en')).toBe('en-GB');
    expect(intlLocale('sw')).toBe('sw-KE');
    expect(intlLocale('fr')).toBe('fr');
    expect(intlLocale('toString')).toBe('toString');
  });
});

describe('formatDate', () => {
  it('formats an ISO date as a calendar day, whatever the timezone', () => {
    expect(formatDate('en', '2026-09-20', 'Africa/Nairobi')).toBe('Sunday 20 September 2026');
    expect(formatDate('en', '2026-12-25', 'Pacific/Honolulu')).toBe('Friday 25 December 2026');
  });

  it('formats other locales with their own month and day names', () => {
    expect(formatDate('fr', '2026-09-20', 'UTC')).toBe('dimanche 20 septembre 2026');
  });

  it('formats a Date as the day it falls on in the timezone', () => {
    const instant = new Date('2026-09-19T22:30:00Z');
    expect(formatDate('en', instant, 'Africa/Nairobi')).toBe('Sunday 20 September 2026');
    expect(formatDate('en', instant, 'UTC')).toBe('Saturday 19 September 2026');
  });

  it('accepts custom format options', () => {
    expect(formatDate('en', '2026-09-20', 'UTC', { day: 'numeric', month: 'short' })).toBe('20 Sept');
  });

  it('rejects invalid dates', () => {
    expect(() => formatDate('en', '20 September', 'UTC')).toThrow(RangeError);
    expect(() => formatDate('en', '2026-9-20', 'UTC')).toThrow(RangeError);
    expect(() => formatDate('en', '2026-02-30', 'UTC')).toThrow(/ISO date/);
    expect(() => formatDate('en', '2026-13-01', 'UTC')).toThrow(/ISO date/);
    expect(() => formatDate('en', new Date('nope'), 'UTC')).toThrow('date is an invalid Date');
  });
});

describe('localePath', () => {
  it('keeps the default locale at the root', () => {
    expect(localePath('en', '', 'en')).toBe('/');
    expect(localePath('en', 'calendar/', 'en')).toBe('/calendar/');
    expect(localePath('en', '//calendar/', 'en')).toBe('/calendar/');
  });

  it('puts other locales under /<locale>/', () => {
    expect(localePath('sw', '', 'en')).toBe('/sw/');
    expect(localePath('sw', '/calendar/2026-09-20/', 'en')).toBe('/sw/calendar/2026-09-20/');
    expect(localePath('en', 'calendar/', 'sw')).toBe('/en/calendar/');
  });
});
