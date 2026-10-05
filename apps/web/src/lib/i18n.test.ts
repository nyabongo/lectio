import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOCALE,
  buildCatalogs,
  flattenCatalog,
  formatDate,
  intlLocale,
  localePath,
  parseCatalogPath,
  translate,
} from './i18n.ts';

const catalogs = buildCatalogs({
  './en/common.json': { default: { nav: { calendar: 'Calendar' }, greeting: 'Hello, {name}' } },
  './en/day.json': {
    title: 'Today',
    notes: { one: '{count} note', other: '{count} notes' },
    words: { zero: 'no words', one: 'one word', other: '{count} words' },
    items: { other: '{count} items' },
  },
  './sw/common.json': { nav: { calendar: 'Kalenda' } },
});

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

  it('treats an object with plural-like keys but no `other` as nesting', () => {
    expect(flattenCatalog({ one: 'a', two: 'b' }, 'f', 'p')).toEqual([
      ['f.one', 'a'],
      ['f.two', 'b'],
    ]);
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
    expect([...catalogs.locales.keys()]).toEqual(['en', 'sw']);
    expect(catalogs.locales.get('en')?.get('common.nav.calendar')).toBe('Calendar');
    expect(catalogs.locales.get('en')?.get('day.title')).toBe('Today');
    expect(catalogs.sources.get('sw:common.nav.calendar')).toBe('./sw/common.json');
  });

  it('throws when two files define the same key', () => {
    expect(() => buildCatalogs({ './en/day.json': { extra: { x: 'a' } }, './en/day.extra.json': { x: 'b' } })).toThrow(
      'key "day.extra.x" (en) is defined in both ./en/day.extra.json and ./en/day.json',
    );
  });

  it('allows the same key in different locales', () => {
    expect(() => buildCatalogs({ './en/a.json': { x: 'a' }, './sw/a.json': { x: 'b' } })).not.toThrow();
  });
});

describe('translate', () => {
  it('returns the message for the locale', () => {
    expect(translate(catalogs, 'en', 'common.nav.calendar')).toBe('Calendar');
    expect(translate(catalogs, 'sw', 'common.nav.calendar')).toBe('Kalenda');
  });

  it('falls back to the default locale for untranslated keys and unknown locales', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(translate(catalogs, 'sw', 'day.title')).toBe('Today');
    expect(translate(catalogs, 'fr', 'day.title')).toBe('Today');
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
    // A form the message lacks falls back to `other`.
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
  it('uses British English for en and the locale itself otherwise', () => {
    expect(intlLocale('en')).toBe('en-GB');
    expect(intlLocale('sw')).toBe('sw');
  });
});

describe('formatDate', () => {
  it('formats an ISO date as a calendar day, whatever the timezone', () => {
    expect(formatDate('en', '2026-09-20', 'Africa/Nairobi')).toBe('Sunday 20 September 2026');
    expect(formatDate('en', '2026-09-20', 'Pacific/Honolulu')).toBe('Sunday 20 September 2026');
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
    expect(() => formatDate('en', '2026-9-20', 'UTC')).toThrow(RangeError);
    expect(() => formatDate('en', '2026-02-30', 'UTC')).toThrow(/ISO date/);
    expect(() => formatDate('en', '2026-13-01', 'UTC')).toThrow(/ISO date/);
    expect(() => formatDate('en', new Date('nope'), 'UTC')).toThrow('date is an invalid Date');
  });
});

describe('localePath', () => {
  it('keeps the default locale at the root', () => {
    expect(localePath('en')).toBe('/');
    expect(localePath('en', 'calendar/')).toBe('/calendar/');
    expect(localePath('en', '//calendar/')).toBe('/calendar/');
  });

  it('puts other locales under /<locale>/', () => {
    expect(localePath('sw')).toBe('/sw/');
    expect(localePath('sw', '/calendar/2026-09-20/')).toBe('/sw/calendar/2026-09-20/');
  });
});
