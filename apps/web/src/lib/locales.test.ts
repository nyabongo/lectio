import { describe, expect, it } from 'vitest';

import { localeAlternates, localeLinks, partLang, pathInLocale, splitLocalePath } from './locales.ts';

const locales = ['en', 'sw'] as const;

describe('splitLocalePath', () => {
  it('reads a non-default locale from the first whole segment', () => {
    expect(splitLocalePath('sw/calendar/', locales, 'en')).toEqual({ locale: 'sw', path: 'calendar/' });
    expect(splitLocalePath('/sw/', locales, 'en')).toEqual({ locale: 'sw', path: '' });
    expect(splitLocalePath('sw', locales, 'en')).toEqual({ locale: 'sw', path: '' });
  });

  it('gives the default locale to everything else', () => {
    expect(splitLocalePath('calendar/', locales, 'en')).toEqual({ locale: 'en', path: 'calendar/' });
    expect(splitLocalePath('', locales, 'en')).toEqual({ locale: 'en', path: '' });
    expect(splitLocalePath('swahili/', locales, 'en')).toEqual({ locale: 'en', path: 'swahili/' });
    expect(splitLocalePath('fr/x/', locales, 'en')).toEqual({ locale: 'en', path: 'fr/x/' });
    // The default locale is never a prefix.
    expect(splitLocalePath('en/calendar/', locales, 'en')).toEqual({ locale: 'en', path: 'en/calendar/' });
  });
});

describe('pathInLocale', () => {
  it('keeps the default locale at the root and prefixes the others', () => {
    expect(pathInLocale('en', 'calendar/', 'en')).toBe('calendar/');
    expect(pathInLocale('sw', '/calendar/', 'en')).toBe('sw/calendar/');
    expect(pathInLocale('sw', '', 'en')).toBe('sw/');
  });
});

describe('localeAlternates', () => {
  it('lists every locale and x-default for a page in any locale', () => {
    const expected = [
      { hreflang: 'en', path: '2026-09-20/gospel/' },
      { hreflang: 'sw', path: 'sw/2026-09-20/gospel/' },
      { hreflang: 'x-default', path: '2026-09-20/gospel/' },
    ];
    expect(localeAlternates('2026-09-20/gospel/', locales, 'en')).toEqual(expected);
    expect(localeAlternates('sw/2026-09-20/gospel/', locales, 'en')).toEqual(expected);
  });

  it('is empty for a single-locale site', () => {
    expect(localeAlternates('calendar/', ['en'], 'en')).toEqual([]);
  });
});

describe('localeLinks', () => {
  it('links the page in every locale and marks the current one', () => {
    expect(localeLinks('sw/calendar/2026/09/', locales, 'en')).toEqual([
      { locale: 'en', path: 'calendar/2026/09/', current: false },
      { locale: 'sw', path: 'sw/calendar/2026/09/', current: true },
    ]);
    expect(localeLinks('', locales, 'en')).toEqual([
      { locale: 'en', path: '', current: true },
      { locale: 'sw', path: 'sw/', current: false },
    ]);
  });
});

describe('partLang', () => {
  it('marks a part only when its language differs from the page', () => {
    expect(partLang('en', 'sw')).toBe('en');
    expect(partLang('en', 'en')).toBeUndefined();
    expect(partLang(undefined, 'sw')).toBeUndefined();
    expect(partLang(null, 'sw')).toBeUndefined();
  });
});
