import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ContentError, openRepo } from '@lectio/content';
import type { ContentFs } from '@lectio/content';

import { loadTranslations, localeSegments } from './repo.ts';
import { SWAHILI_STRINGS } from './swahili.ts';

const ROOT = fileURLToPath(new URL('fixtures/repo', import.meta.url));
const repo = openRepo(ROOT);

/** Node's fs, with extra files and failures layered on top. */
function fsWith(files: Record<string, string>, failing?: Error): ContentFs {
  return {
    readFile: (path) => files[path] ?? readFileSync(path, 'utf8'),
    readdir: (path) => {
      if (failing) throw failing;
      return [...readdirSync(path), ...Object.keys(files).map((file) => file.slice(path.length + 1))];
    },
  };
}

describe('loadTranslations', () => {
  it('reads the locale directory in key order', () => {
    const translations = loadTranslations(repo, 'sw');
    expect(translations.map(({ translationOf, locale }) => `${locale}/${translationOf}`)).toEqual([
      'sw/IS.55.6-9',
      'sw/MT.20.1-16',
    ]);
  });

  it('has none for a locale without a directory', () => {
    expect(loadTranslations(repo, 'fr')).toEqual([]);
  });

  it('skips files that are not translations', () => {
    const dir = `${ROOT}/passages/i18n/sw`;
    const fs = fsWith({ [`${dir}/README.md`]: '# notes', [`${dir}/not-a-key.json`]: '{}' });
    expect(loadTranslations(repo, 'sw', fs)).toHaveLength(2);
  });

  it('rejects an invalid translation with its file', () => {
    const fs = fsWith({ [`${ROOT}/passages/i18n/sw/LK.9.1-6.json`]: '{"translationOf":"LK.9.1-6"}' });
    expect(() => loadTranslations(repo, 'sw', fs)).toThrow(ContentError);
    expect(() => loadTranslations(repo, 'sw', fs)).toThrow(/passages\/i18n\/sw\/LK\.9\.1-6\.json/);
  });

  it('passes on any failure other than a missing directory', () => {
    const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    expect(() => loadTranslations(repo, 'sw', fsWith({}, denied))).toThrow(/permission denied/);
  });
});

describe('localeSegments', () => {
  it('narrates the narratable translations and reports the others', () => {
    const { segments, skipped } = localeSegments(repo, 'sw');
    expect(segments.map((segment) => segment.id)).toEqual([
      'MT.20.1-16/context',
      'MT.20.1-16/note/evil-eye',
      'MT.20.1-16/note/agathos',
    ]);
    expect(segments.every((segment) => segment.locale === 'sw' && segment.slot === 'gospel')).toBe(true);
    expect(skipped).toEqual([{ key: 'IS.55.6-9', locale: 'sw', reason: 'source-unapproved' }]);
  });

  it('reports a translation whose English passage is gone', () => {
    const dir = `${ROOT}/passages/i18n/sw`;
    const moved = readFileSync(`${dir}/IS.55.6-9.json`, 'utf8').replace(/IS\.55\.6-9/g, 'IS.55.10-11');
    const { skipped } = localeSegments(repo, 'sw', { fs: fsWith({ [`${dir}/IS.55.10-11.json`]: moved }) });
    expect(skipped).toContainEqual({ key: 'IS.55.10-11', locale: 'sw', reason: 'missing-source' });
  });

  it('includes pending ones on request and takes another narration', () => {
    const narration = { strings: { ...SWAHILI_STRINGS, contextIntro: () => 'X' }, speakReferences: (t: string) => t };
    const { segments, skipped } = localeSegments(repo, 'sw', { includeUnapproved: true, narration });
    expect(skipped).toEqual([]);
    expect(segments[0]?.id).toBe('IS.55.6-9/context');
    expect(segments[0]?.text.startsWith('X ')).toBe(true);
  });

  it('throws for a locale without narration', () => {
    expect(() => localeSegments(repo, 'fr')).toThrow(/No narration/);
  });
});
