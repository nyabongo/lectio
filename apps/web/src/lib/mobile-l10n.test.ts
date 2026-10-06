import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CATALOG_DIRS,
  CATALOG_LOCALES,
  CatalogError,
  DART_CATALOG_PATH,
  arbPath,
  arbSource,
  dartSource,
  encodeJson,
  flattenCatalog,
  generatedFiles,
  icuMessage,
  looksPlural,
  parityProblems,
  parseJsonInOrder,
  placeholdersOf,
  readCatalogs,
  syncL10n,
} from './mobile-l10n.ts';
import type { Catalogs, Messages } from './mobile-l10n.ts';

const mobileRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../mobile');
const FIXTURE = join(mobileRoot, 'test/fixtures/l10n');

const map = (entries: Record<string, unknown>): Map<string, unknown> => new Map(Object.entries(entries));
const plural = (entries: Record<string, string>): Map<string, string> => new Map(Object.entries(entries));

function flat(json: unknown, feature = 'day'): Messages {
  const into: Messages = new Map();
  flattenCatalog(json, feature, `en/${feature}.json`, into);
  return into;
}

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Writes catalog `files` (`<dir>/<locale>/<feature>.json` → JSON text or value) under a new temporary directory. */
function catalogTree(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'mobile-l10n-'));
  temporary.push(root);
  for (const [path, json] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof json === 'string' ? json : JSON.stringify(json));
  }
  return root;
}

/** A matching pair of site and app catalogs. */
const validTree = (): Record<string, unknown> => ({
  'web/en/day.json': { title: 'Today', count: { one: '{count} day', other: '{count} days' } },
  'web/sw/day.json': { title: 'Leo', count: { one: 'siku {count}', other: 'siku {count}' } },
  'app/en/app.json': { retry: 'Try {what} again' },
  'app/sw/app.json': { retry: 'Jaribu {what} tena' },
});
const testDirs = ['web', 'app'];

describe('the committed files', () => {
  it('are what the Node port generates, byte for byte (flutter.yml checks them against the Dart tool)', () => {
    const files = generatedFiles(readCatalogs(mobileRoot));
    expect([...files.keys()]).toEqual(['lib/l10n/app_en.arb', 'lib/l10n/app_sw.arb', 'lib/l10n/catalog.g.dart']);
    for (const [path, content] of files) {
      // On failure: run `npm run l10n:sync` and commit the result.
      expect(readFileSync(join(mobileRoot, path), 'utf8'), path).toBe(content);
    }
  });

  it('match the Dart tool on the edge-case fixture (apps/mobile/test/fixtures/l10n, checked by its Dart test too)', () => {
    const files = generatedFiles(readCatalogs(join(FIXTURE, 'src'), { dirs: testDirs }));
    for (const [path, content] of files) {
      const name = path.split('/').at(-1) as string;
      expect(content, name).toBe(readFileSync(join(FIXTURE, 'expected', name), 'utf8'));
    }
  });
});

describe('constants', () => {
  it('match the Dart tool', () => {
    expect(CATALOG_LOCALES).toEqual(['en', 'sw']);
    expect(CATALOG_DIRS).toEqual(['../web/src/i18n', 'lib/l10n/catalog']);
    expect(arbPath('sw')).toBe('lib/l10n/app_sw.arb');
    expect(DART_CATALOG_PATH).toBe('lib/l10n/catalog.g.dart');
  });
});

describe('parseJsonInOrder', () => {
  it('reads objects as maps in file order, a repeated key in its first place with its last value', () => {
    const value = parseJsonInOrder(
      ' { "b": 1, "2": "two", "b": { "x" : [ ] }, "a\\"q": [true, false, null, -1.5e3] } ',
      'f',
    );
    expect(value).toEqual(
      new Map<string, unknown>([
        ['b', new Map([['x', []]])],
        ['2', 'two'],
        ['a"q', [true, false, null, -1500]],
      ]),
    );
    expect([...(value as Map<string, unknown>).keys()]).toEqual(['b', '2', 'a"q']);
    expect(parseJsonInOrder('{}', 'f')).toEqual(new Map());
    expect(parseJsonInOrder('"s"', 'f')).toBe('s');
  });

  it('names the file for malformed JSON', () => {
    expect(() => parseJsonInOrder('{', 'en/bad.json')).toThrow(CatalogError);
    expect(() => parseJsonInOrder('{', 'en/bad.json')).toThrow(/^en\/bad\.json: /);
  });
});

describe('looksPlural', () => {
  it('needs two or more plural categories with one or other', () => {
    expect(looksPlural(map({ one: 'a', other: 'b' }))).toBe(true);
    expect(looksPlural(map({ few: 'a', other: 'b' }))).toBe(true);
    expect(looksPlural(map({ other: 'a' }))).toBe(false);
    expect(looksPlural(map({ one: 'a', label: 'b' }))).toBe(false);
    expect(looksPlural(map({ zero: 'a', two: 'b' }))).toBe(false);
    expect(looksPlural(map({ one: 'a', other: new Map() }))).toBe(false);
  });
});

describe('flattenCatalog', () => {
  it('joins nested keys with _ under the feature', () => {
    expect(flat(map({ title: 'Today', slot: map({ psalm: 'Psalm', psalmN: 'Psalm {n}' }) }))).toEqual(
      new Map([
        ['day_title', 'Today'],
        ['day_slot_psalm', 'Psalm'],
        ['day_slot_psalmN', 'Psalm {n}'],
      ]),
    );
  });

  it('keeps plural messages whole, in CLDR order', () => {
    const messages = flat(map({ masses: map({ other: '{count} Masses', one: '{count} Mass' }) }));
    const masses = messages.get('day_masses') as Map<string, string>;
    expect([...masses]).toEqual([
      ['one', '{count} Mass'],
      ['other', '{count} Masses'],
    ]);
  });

  it('rejects values that are not strings or objects, plurals without other, empty objects and bad keys', () => {
    expect(() => flat(map({ n: 1 }))).toThrow('en/day.json: "day_n" must be a string or an object');
    expect(() => flat(map({ n: [] }))).toThrow(CatalogError);
    expect(() => flat(map({ n: map({ one: 'a', few: 'b' }) }))).toThrow('"day_n" needs an "other" form');
    expect(() => flat(map({ n: new Map() }))).toThrow('"day_n" is empty');
    expect(() => flat(map({ 'a-b': 'x' }))).toThrow('key "a-b" under "day" must be letters and digits');
  });
});

describe('placeholdersOf', () => {
  it('lists each placeholder once, sorted, across plural forms', () => {
    expect(placeholdersOf('{b} and {a} and {b}')).toEqual(['a', 'b']);
    expect(placeholdersOf(plural({ one: '{count} x', other: '{n}' }))).toEqual(['count', 'n']);
    expect(placeholdersOf('none')).toEqual([]);
  });
});

describe('parityProblems', () => {
  const catalogs = (sw: Messages): Catalogs =>
    new Map([
      [
        'en',
        new Map<string, string | Map<string, string>>([
          ['a', 'A {x}'],
          ['b', plural({ one: '1', other: '{count}' })],
        ]),
      ],
      ['sw', sw],
    ]);

  it('is empty when every key matches', () => {
    expect(
      parityProblems(
        catalogs(
          new Map<string, string | Map<string, string>>([
            ['a', 'A {x} sw'],
            ['b', plural({ one: 'moja', other: '{count}' })],
          ]),
        ),
      ),
    ).toEqual([]);
  });

  it('reports missing, extra and mismatched keys', () => {
    expect(
      parityProblems(
        catalogs(
          new Map([
            ['a', 'A'],
            ['c', 'C'],
          ]),
        ),
      ),
    ).toEqual(['sw: "a" is "text", en is "text x"', 'sw: missing "b"', 'sw: "c" is not in en']);
    expect(
      parityProblems(
        catalogs(
          new Map([
            ['a', 'A {x}'],
            ['b', 'B {count}'],
          ]),
        ),
      ),
    ).toEqual(['sw: "b" is "text count", en is "plural count"']);
  });
});

describe('icuMessage', () => {
  it('writes plain text as is and plurals in ICU form', () => {
    expect(icuMessage('Psalm {n}')).toBe('Psalm {n}');
    expect(icuMessage(plural({ one: '{count} Mass', other: 'Masses' }))).toBe(
      '{count, plural, one{{count} Mass} other{Masses}}',
    );
  });
});

describe('encodeJson', () => {
  it("writes maps as Dart's JsonEncoder.withIndent('  ') does", () => {
    const value = new Map<string, string | Map<string, string>>([
      ['a', 'x "y"\n'],
      ['e', new Map()],
      ['m', new Map([['k', 'v']])],
    ]);
    expect(encodeJson(value)).toBe('{\n  "a": "x \\"y\\"\\n",\n  "e": {},\n  "m": {\n    "k": "v"\n  }\n}');
  });
});

describe('arbSource', () => {
  const messages: Messages = new Map<string, string | Map<string, string>>([
    ['a', 'Plain'],
    ['b', 'Hello {name}'],
    ['c', plural({ one: '{count} day', other: '{count} days' })],
  ]);

  it('describes the placeholders in the template', () => {
    expect(JSON.parse(arbSource('en', messages, true))).toEqual({
      '@@locale': 'en',
      a: 'Plain',
      b: 'Hello {name}',
      '@b': { placeholders: { name: {} } },
      c: '{count, plural, one{{count} day} other{{count} days}}',
      '@c': { placeholders: { count: { type: 'num' } } },
    });
  });

  it('leaves the metadata out of translations', () => {
    const arb = arbSource('sw', messages, false);
    expect(arb.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(arb) as object)).toEqual(['@@locale', 'a', 'b', 'c']);
  });
});

describe('dartSource', () => {
  it('embeds the catalogs as JSON in a raw string', () => {
    const catalogs: Catalogs = new Map([['en', new Map([['a', 'It\'s "a" \\ b']])]]);
    const source = dartSource(catalogs);
    expect(source.startsWith('// GENERATED by tool/sync_l10n.dart')).toBe(true);
    const json = source.slice(source.indexOf("r'''\n") + 5, source.lastIndexOf("\n''';"));
    expect(JSON.parse(json)).toEqual({ en: { a: 'It\'s "a" \\ b' } });
  });

  it("refuses a message containing '''", () => {
    expect(() => dartSource(new Map([['en', new Map([['a', "'''"]])]]))).toThrow(CatalogError);
  });
});

describe('readCatalogs', () => {
  it('merges the directories feature by feature, per locale', () => {
    const catalogs = readCatalogs(catalogTree(validTree()), { dirs: testDirs });
    expect([...catalogs.keys()]).toEqual(['en', 'sw']);
    expect([...(catalogs.get('en') as Messages).keys()]).toEqual(['app_retry', 'day_title', 'day_count']);
    expect(catalogs.get('sw')?.get('day_title')).toBe('Leo');
  });

  it('ignores files that are not JSON catalogs, directories, dangling links and missing directories', () => {
    const root = catalogTree({ ...validTree(), 'web/sw/catalog.test.ts': 'export {};' });
    mkdirSync(join(root, 'web/en/nested.json'));
    symlinkSync(join(root, 'nowhere.json'), join(root, 'web/en/gone.json'));
    expect(readCatalogs(root, { dirs: testDirs }).get('sw')?.size).toBe(3);
    expect(readCatalogs(root, { dirs: [...testDirs, 'missing'] }).get('en')?.size).toBe(3);
  });

  it('rejects a feature defined twice, a locale without catalogs, bad feature names and malformed JSON', () => {
    expect(() =>
      readCatalogs(catalogTree({ ...validTree(), 'app/en/day.json': { title: 'Again' } }), { dirs: testDirs }),
    ).toThrow(/^app\/en\/day\.json: feature "day" is also defined in .*\/web\/en\/day\.json$/);
    expect(() => readCatalogs(catalogTree({ 'web/en/day.json': { title: 'Today' } }), { dirs: testDirs })).toThrow(
      'no catalog for locale "sw"',
    );
    expect(() =>
      readCatalogs(catalogTree({ ...validTree(), 'web/en/my-day.json': { a: 'b' } }), { dirs: testDirs }),
    ).toThrow('web/en/my-day.json: the feature name must be letters and digits');
    expect(() => readCatalogs(catalogTree({ ...validTree(), 'web/en/bad.json': '{' }), { dirs: testDirs })).toThrow(
      CatalogError,
    );
  });
});

describe('generatedFiles', () => {
  it('writes an ARB per locale and the Dart catalog', () => {
    const files = generatedFiles(readCatalogs(catalogTree(validTree()), { dirs: testDirs }));
    expect([...files.keys()]).toEqual(['lib/l10n/app_en.arb', 'lib/l10n/app_sw.arb', 'lib/l10n/catalog.g.dart']);
    expect(files.get('lib/l10n/app_en.arb')).toContain('"@day_count"');
    expect(files.get('lib/l10n/app_sw.arb')).not.toContain('"@day_count"');
  });

  it('refuses catalogs that do not match', () => {
    expect(() =>
      generatedFiles(
        new Map([
          ['en', new Map([['a', 'A']])],
          ['sw', new Map()],
        ]),
      ),
    ).toThrow('sw: missing "a"');
  });
});

describe('syncL10n', () => {
  /** The repository layout: the site's catalogs under `web/src/i18n`, the app's under `mobile/lib/l10n/catalog`. */
  function appTree(): string {
    const files = Object.fromEntries(
      Object.entries(validTree()).map(([path, json]) => [
        path.replace(/^web\//, 'web/src/i18n/').replace(/^app\//, 'mobile/lib/l10n/catalog/'),
        json,
      ]),
    );
    return join(catalogTree(files), 'mobile');
  }

  const sink = () => {
    const lines: string[] = [];
    return { lines, write: (text: string) => lines.push(text) };
  };

  it('writes the files, then finds them up to date', () => {
    const app = appTree();
    const out = sink();
    const err = sink();
    expect(syncL10n(app, { out, err, check: true })).toBe(1);
    expect(err.lines.join('')).toContain('out of date: lib/l10n/app_en.arb, lib/l10n/app_sw.arb');
    expect(err.lines.join('')).toContain('npm run l10n:sync');
    expect(existsSync(join(app, DART_CATALOG_PATH))).toBe(false);

    expect(syncL10n(app, { out, err })).toBe(0);
    expect(out.lines).toEqual(['sync_l10n: wrote 3 file(s) (3 generated files)\n']);
    expect(existsSync(join(app, DART_CATALOG_PATH))).toBe(true);

    expect(syncL10n(app, { out, err, check: true })).toBe(0);
    expect(syncL10n(app, { out, err })).toBe(0);
    expect(out.lines.slice(1)).toEqual([
      'sync_l10n: up to date (3 generated files)\n',
      'sync_l10n: wrote 0 file(s) (3 generated files)\n',
    ]);
  });

  it('fails on a broken catalog', () => {
    const err = sink();
    expect(syncL10n(catalogTree({}), { out: sink(), err })).toBe(1);
    expect(err.lines).toEqual(['sync_l10n: no catalog for locale "en"\n']);
  });
});
