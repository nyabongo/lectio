import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildCatalogs, flattenCatalog, parseCatalogPath, translate } from '../lib/i18n.ts';
import { siteContext } from '../lib/site.ts';
import { DEFAULT_LOCALE, catalogs, formatDate, localePath, t } from './index.ts';

const i18nDir = fileURLToPath(new URL('.', import.meta.url));
const srcDir = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

/** Every catalog file on disk, as `./<locale>/<feature>.json`. */
const catalogFiles = walk(i18nDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => `./${relative(i18nDir, file).split('\\').join('/')}`);

function readCatalog(file: string): unknown {
  return JSON.parse(readFileSync(join(i18nDir, file), 'utf8')) as unknown;
}

/** Source files that can call `t` (tests excluded). */
const sources = walk(srcDir).filter((file) => /\.(astro|[cm]?[jt]sx?)$/.test(file) && !/\.test\.[^/]+$/.test(file));

// `t(<locale>, '<key>'` with a literal key; `t(<locale>, someVariable` is a dynamic key the checks cannot see.
// The locale argument may itself call something (`t(getLang(), …)`, `t(pick(a, b), …)`), up to two levels deep.
const CALL_START = String.raw`(?<![\w$.])(?<!function )t\(\s*`;
const LOCALE_ARG = String.raw`(?:[^,()]|\((?:[^()]|\([^()]*\))*\))+?`;
const LITERAL_CALL = new RegExp(String.raw`${CALL_START}${LOCALE_ARG},\s*(['"\x60])([\w.-]+)\1`, 'g');
const DYNAMIC_CALL = new RegExp(String.raw`${CALL_START}${LOCALE_ARG},\s*(?!['"\x60])[^\s)]`, 'g');

function keysIn(source: string): { keys: string[]; dynamic: number } {
  return {
    keys: [...source.matchAll(LITERAL_CALL)].map((match) => match[2] ?? ''),
    dynamic: [...source.matchAll(DYNAMIC_CALL)].length,
  };
}

const usage = sources.map((file) => ({ file: relative(srcDir, file), ...keysIn(readFileSync(file, 'utf8')) }));
const usedKeys = new Set(usage.flatMap((entry) => entry.keys));
const defaultKeys = new Set(catalogs.locales.get(DEFAULT_LOCALE)?.keys());

describe('key scanner', () => {
  it('finds literal keys in .ts and .astro call shapes and counts dynamic ones', () => {
    const sample = [
      "t(lang, 'common.a')",
      '{t(lang, "common.b", { title })}',
      't("en", `common.c`)',
      'format(x, "common.ignored"); it(x, "nope"); obj.t(lang, "nope.method")',
      't(lang, key)',
      "t(getLang(), 'common.d'); t(pick(a, b), 'common.e'); t(locale(of(x)), 'common.f')",
      't(getLang(), keyFor(x))',
      'export function t(locale: string, key: string) {}',
      "/** calls `t(locale, '<feature>.<key>')` and `t(…)` */",
    ].join('\n');
    expect(keysIn(sample)).toEqual({
      keys: ['common.a', 'common.b', 'common.c', 'common.d', 'common.e', 'common.f'],
      dynamic: 2,
    });
  });
});

describe('catalogs in src/i18n', () => {
  it('loads every catalog file on disk', () => {
    expect(catalogFiles).toContain('./en/common.json');
    expect(new Set(catalogs.sources.values())).toEqual(new Set(catalogFiles));
  });

  it('defines no key in two files', () => {
    // Flatten each file on its own (not through buildCatalogs, which would throw first) and list every key that
    // more than one file of a locale defines.
    const definedIn = new Map<string, string[]>();
    for (const file of catalogFiles) {
      const { locale, feature } = parseCatalogPath(file);
      for (const [key] of flattenCatalog(readCatalog(file), feature, file)) {
        const id = `${locale}:${key}`;
        definedIn.set(id, [...(definedIn.get(id) ?? []), file]);
      }
    }
    const duplicates = [...definedIn].filter(([, files]) => files.length > 1);
    expect(duplicates).toEqual([]);
    expect(definedIn.size).toBe(catalogs.sources.size);
    expect(() => buildCatalogs(Object.fromEntries(catalogFiles.map((f) => [f, readCatalog(f)])), 'en')).not.toThrow();
  });

  it('uses only literal keys in t() calls', () => {
    expect(usage.filter((entry) => entry.dynamic > 0).map((entry) => entry.file)).toEqual([]);
  });

  it('defines every key used in src', () => {
    expect([...usedKeys].filter((key) => !defaultKeys.has(key))).toEqual([]);
    expect(usedKeys.size).toBeGreaterThan(0);
  });

  it('has no unused keys', () => {
    const unused = [...catalogs.sources.keys()]
      .map((entry) => entry.slice(entry.indexOf(':') + 1))
      .filter((key) => !usedKeys.has(key));
    expect(unused).toEqual([]);
  });

  it('translates no key that the default locale lacks', () => {
    const extra = [...catalogs.locales.entries()].flatMap(([locale, messages]) =>
      [...messages.keys()].filter((key) => !defaultKeys.has(key)).map((key) => `${locale}:${key}`),
    );
    expect(extra).toEqual([]);
  });

  it('makes a new feature file work with no other edit', () => {
    const modules = Object.fromEntries(catalogFiles.map((file) => [file, readCatalog(file)]));
    const withFoo = buildCatalogs({ ...modules, './en/foo.json': { x: 'Foo {n}' } }, DEFAULT_LOCALE);
    expect(translate(withFoo, 'en', 'foo.x', { n: 1 })).toBe('Foo 1');
    expect(translate(withFoo, 'en', 'common.nav.calendar')).toBe('Calendar');
  });
});

describe('src/i18n', () => {
  it('translates with the real catalogs', () => {
    expect(t('en', 'common.site.name')).toBe('Lectio');
    expect(t('en', 'common.site.pageTitle', { title: 'Calendar' })).toBe('Calendar · Lectio');
  });

  it('formats dates in the config timezone', () => {
    expect(formatDate('en', '2026-09-20')).toBe('Sunday 20 September 2026');
    // 22:30 UTC on the 19th is already the 20th in Nairobi (the default config's timezone).
    expect(formatDate('en', new Date('2026-09-19T22:30:00Z'))).toBe('Sunday 20 September 2026');
    expect(formatDate('en', '2026-09-20', { month: 'long', year: 'numeric' })).toBe('September 2026');
  });

  it('takes the default locale from the config and keeps it at the root', () => {
    expect(DEFAULT_LOCALE).toBe(siteContext().config.site.defaultLocale);
    expect(catalogs.defaultLocale).toBe(DEFAULT_LOCALE);
    expect(localePath(DEFAULT_LOCALE, 'calendar/')).toBe('/calendar/');
    expect(localePath(DEFAULT_LOCALE)).toBe('/');
    expect(localePath('xx', 'calendar/')).toBe('/xx/calendar/');
  });
});
