/**
 * Kiswahili catalog parity (L-110): every `en/<feature>.json` has a `sw/<feature>.json`, and every English key
 * exists in it with the same shape (plain or plural), the same `{placeholders}` and the same Pagefind
 * `[TOKENS]`, so no Kiswahili page falls back to English and no translated string drops a value.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { flattenCatalog } from '../../lib/i18n.ts';
import type { Message } from '../../lib/i18n.ts';
import { localeOf, t } from '../index.ts';

const i18nDir = fileURLToPath(new URL('..', import.meta.url));

const features = (locale: string): string[] =>
  readdirSync(join(i18nDir, locale))
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort();

function catalog(locale: string, feature: string): Map<string, Message> {
  const path = `./${locale}/${feature}.json`;
  return new Map(
    flattenCatalog(
      JSON.parse(readFileSync(join(i18nDir, locale, `${feature}.json`), 'utf8')) as unknown,
      feature,
      path,
    ),
  );
}

/** The `{name}` placeholders and `[TOKEN]`s of a message, all plural forms together. */
function slots(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message);
  return [...new Set(texts.flatMap((text) => [...text.matchAll(/\{\w+\}|\[[A-Z_]+\]/g)].map((m) => m[0])))].sort();
}

const shape = (message: Message): string => (typeof message === 'string' ? 'text' : 'plural');

describe('Kiswahili catalogs', () => {
  it('has one sw catalog per English catalog', () => {
    expect(features('sw')).toEqual(features('en'));
  });

  describe.each(features('en'))('%s.json', (feature) => {
    const en = catalog('en', feature);
    const sw = catalog('sw', feature);

    it('has every English key', () => {
      expect([...en.keys()].filter((key) => !sw.has(key))).toEqual([]);
    });

    it('keeps each message’s shape, placeholders and tokens', () => {
      const mismatches = [...en].flatMap(([key, message]) => {
        const translated = sw.get(key);
        if (translated === undefined) return [];
        const want = `${shape(message)} ${slots(message).join(' ')}`;
        const got = `${shape(translated)} ${slots(translated).join(' ')}`;
        return want === got ? [] : [`${key}: expected ${want}, got ${got}`];
      });
      expect(mismatches).toEqual([]);
    });

    it('translates rather than copies prose', () => {
      // Names and pure formats may match English; a sentence should not.
      const copied = [...en].filter(([key, message]) => {
        const translated = sw.get(key);
        return typeof message === 'string' && message.split(' ').length > 3 && translated === message;
      });
      expect(copied.map(([key]) => key)).toEqual([]);
    });
  });

  it('is what Kiswahili pages render', () => {
    expect(t('sw', 'common.nav.calendar')).toBe('Kalenda');
    expect(t('sw', 'calendar.library.notes', { count: 1 })).toBe('dokezo 1');
    expect(t('sw', 'calendar.library.notes', { count: 3 })).toBe('madokezo 3');
  });
});

describe('localeOf', () => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

  it('reads the page locale from its URL', () => {
    expect(localeOf(new URL(`https://example.org${base}sw/calendar/`))).toBe('sw');
    expect(localeOf(new URL(`https://example.org${base}sw/`))).toBe('sw');
    expect(localeOf(new URL(`https://example.org${base}calendar/`))).toBe('en');
    expect(localeOf(new URL(`https://example.org${base}`))).toBe('en');
  });
});
