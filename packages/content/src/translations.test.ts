/**
 * Translations (`passages/i18n/<locale>/<key>.json`, L-112) in the content package: locating them,
 * validating them against their English passage, and `content:validate` listing them. Uses an
 * in-memory file system and the schema package's fixtures (commentary only).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ContentError } from './errors.ts';
import { checkTranslatedPassage, contentKindOf, translationPlaceOf } from './files.ts';
import type { ContentFs } from './files.ts';
import { contentFilesUnder, validateContentFiles } from './validate-files.ts';

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');
const ENGLISH_TEXT = read('../../schema/fixtures/passage/valid/pending.json');
const SW_TEXT = read('../../schema/src/translated-passage/fixtures/valid/pending.json');
const english = JSON.parse(ENGLISH_TEXT) as Parameters<typeof checkTranslatedPassage>[3];
const sw = (): Record<string, unknown> => JSON.parse(SW_TEXT) as Record<string, unknown>;

const ROOT = '/repo';
const EN = `${ROOT}/passages/MT.20.1-16.json`;
const SW = `${ROOT}/passages/i18n/sw/MT.20.1-16.json`;

/** An in-memory file system over `files` (absolute path → text); directories are implied. */
function memoryFs(files: Readonly<Record<string, string>>): ContentFs {
  const missing = (path: string): Error => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
  return {
    readFile: (path) => {
      const text = files[path];
      if (text === undefined) throw missing(path);
      return text;
    },
    readdir: (path) => {
      const prefix = `${path}/`;
      const names = Object.keys(files)
        .filter((file) => file.startsWith(prefix))
        .map((file) => file.slice(prefix.length).split('/')[0] as string);
      if (names.length === 0) throw missing(path);
      return [...new Set(names)];
    },
  };
}

function errorsOf(files: Record<string, string>, paths: string[] = [SW]): string[] {
  return validateContentFiles(paths, ROOT, memoryFs(files)).errors.flatMap((error) =>
    error.issues.map((issue) => `${error.file}#${issue.pointer} ${issue.message}`),
  );
}

describe('translationPlaceOf', () => {
  it('finds the locale and key of a translation under any root, and nothing else', () => {
    expect(translationPlaceOf(SW)).toEqual({ locale: 'sw', key: 'MT.20.1-16' });
    expect(translationPlaceOf('passages\\i18n\\sw\\MT.20.1-16.json')).toEqual({ locale: 'sw', key: 'MT.20.1-16' });
    expect(translationPlaceOf(EN)).toBeNull();
    expect(translationPlaceOf('passages/i18n/en/MT.20.1-16.json')).toBeNull();
    expect(contentKindOf(SW)).toBeNull();
  });
});

describe('checkTranslatedPassage', () => {
  it('returns a valid translation that lines up with its English passage', () => {
    expect(checkTranslatedPassage(sw(), 'f', { locale: 'sw', key: 'MT.20.1-16' }, english)).toEqual(sw());
    expect(checkTranslatedPassage(sw(), 'f')).toEqual(sw());
  });

  it('names schema problems, a wrong place and mismatches with the English passage', () => {
    expect(() => checkTranslatedPassage({}, 'f')).toThrow(ContentError);
    const value = { ...sw(), claims: (sw()['claims'] as unknown[]).slice(1) };
    try {
      checkTranslatedPassage(value, 'f', { locale: 'pt-BR', key: 'MT.20.1-15' }, english);
      expect.unreachable();
    } catch (error) {
      expect((error as ContentError).issues.map((issue) => issue.pointer)).toEqual([
        '/locale',
        '/translationOf',
        '/claims',
      ]);
    }
  });
});

describe('content:validate over translations', () => {
  it('lists passages/i18n/<locale>/*.json after the passages, skipping English and non-locale entries', () => {
    const fs = memoryFs({
      [EN]: ENGLISH_TEXT,
      [SW]: SW_TEXT,
      [`${ROOT}/passages/i18n/pt-BR/PS.23.json`]: '{}',
      [`${ROOT}/passages/i18n/en/MT.20.1-16.json`]: '{}',
      [`${ROOT}/passages/i18n/README.md`]: 'x',
      [`${ROOT}/passages/i18n/sw/notes.txt`]: 'x',
    });
    expect(contentFilesUnder(ROOT, fs)).toEqual([EN, `${ROOT}/passages/i18n/pt-BR/PS.23.json`, SW]);
    expect(contentFilesUnder('/empty', memoryFs({ '/empty/passages/MT.1.json': '{}' }))).toEqual([
      '/empty/passages/MT.1.json',
    ]);
  });

  it('rethrows unexpected errors listing translations', () => {
    const fs: ContentFs = {
      readFile: () => '',
      readdir: (path) => {
        if (path.endsWith('i18n')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    };
    expect(() => contentFilesUnder(ROOT, fs)).toThrow('EACCES');
  });

  it('accepts a valid translation of an existing English passage', () => {
    expect(errorsOf({ [EN]: ENGLISH_TEXT, [SW]: SW_TEXT })).toEqual([]);
  });

  it('reports a missing English passage', () => {
    expect(errorsOf({ [SW]: SW_TEXT })).toEqual([
      'passages/i18n/sw/MT.20.1-16.json#/translationOf the English passage passages/MT.20.1-16.json does not exist',
    ]);
  });

  it('checks the translation alone when the English passage is invalid', () => {
    expect(errorsOf({ [EN]: '{}', [SW]: SW_TEXT })).toEqual([]);
    const bad = JSON.stringify({ ...sw(), summary: '' });
    expect(errorsOf({ [EN]: '{}', [SW]: bad })[0]).toMatch(/^passages\/i18n\/sw\/MT\.20\.1-16\.json#\/summary /);
  });

  it('reports mismatches with the English passage and invalid JSON', () => {
    const extra = JSON.stringify({ ...sw(), claims: [...(sw()['claims'] as unknown[]), { id: 'c9', text: 'Ziada.' }] });
    expect(errorsOf({ [EN]: ENGLISH_TEXT, [SW]: extra })).toEqual([
      'passages/i18n/sw/MT.20.1-16.json#/claims/5/id claim c9 is not in the English passage',
    ]);
    expect(errorsOf({ [EN]: ENGLISH_TEXT, [SW]: '{' })[0]).toMatch(/not valid JSON/);
  });

  it('reports an unreadable English passage as unreadable', () => {
    const fs = memoryFs({ [SW]: SW_TEXT });
    const denied: ContentFs = {
      ...fs,
      readFile: (path) => {
        if (path === EN) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
        return fs.readFile(path);
      },
    };
    const [error] = validateContentFiles([SW], ROOT, denied).errors;
    expect(error?.message).toMatch(/cannot read file \(EACCES\)/);
    expect(dirname(dirname(dirname(SW)))).toBe(join(ROOT, 'passages'));
  });
});
