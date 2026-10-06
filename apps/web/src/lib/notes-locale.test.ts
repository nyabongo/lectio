/**
 * Notes in the reader's language (L-113): fresh, stale, unapproved, mismatched and missing translations, the
 * localised repository view over the fixture content root, and Kiswahili references.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ContentError, openRepo } from '@lectio/content';
import type { ContentFs } from '@lectio/content';
import type { Passage, PassageClaim } from '@lectio/schema/passage';
import type { TranslatedClaim, TranslatedPassage } from '@lectio/schema/translated-passage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  localeRepo,
  overlaySource,
  overlayTranslation,
  passageInLocale,
  refLabelIn,
  siteRepo,
  swahiliBookName,
  translationSource,
  translationStatus,
} from './notes-locale.ts';
import { readingsBySlot } from './reading.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contentRoot = resolve(webRoot, 'test/fixtures/content');
const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(contentRoot, path), 'utf8')) as T;
const english = (): Passage => read<Passage>('passages/MT.20.1-16.json');
const kiswahili = (): TranslatedPassage => read<TranslatedPassage>('passages/i18n/sw/MT.20.1-16.json');

describe('translationStatus', () => {
  it('is translated for an approved translation of the English as it is now', () => {
    expect(translationStatus(english(), kiswahili())).toBe('translated');
  });

  it('is missing without a translation', () => {
    expect(translationStatus(english(), null)).toBe('missing');
    expect(translationStatus(english(), undefined)).toBe('missing');
  });

  it('is unapproved while the translation is pending review', () => {
    expect(translationStatus(english(), { ...kiswahili(), review: { status: 'pending', reviewers: [] } })).toBe(
      'unapproved',
    );
  });

  it('is stale once the English wording changes, and fresh again for whitespace-only edits', () => {
    const changed = english();
    changed.summary = `${changed.summary} More.`;
    expect(translationStatus(changed, kiswahili())).toBe('stale');
    const respaced = english();
    respaced.summary = `  ${respaced.summary.replace(' ', '   ')}\n`;
    expect(translationStatus(respaced, kiswahili())).toBe('translated');
  });

  it('is a mismatch when the translation no longer lines up with the English notes', () => {
    const translation = kiswahili();
    translation.translationNotes = translation.translationNotes.slice(1);
    expect(translationStatus(english(), translation)).toBe('mismatch');
  });
});

describe('overlayTranslation', () => {
  it('lays the translated prose over the English passage and keeps everything else', () => {
    const source = english();
    const translation = kiswahili();
    const shown = overlayTranslation(source, translation);
    expect(shown.locale).toBe('sw');
    expect(shown.summary).toBe(translation.summary);
    expect(shown.context).toEqual(translation.context);
    const [evilEye, agathos] = shown.translationNotes;
    expect(evilEye).toMatchObject({
      id: 'v15-evil-eye',
      verse: '20:15',
      anchor: 'wivu',
      summary: translation.translationNotes[0]?.summary,
      body: translation.translationNotes[0]?.body,
      original: {
        text: 'ὀφθαλμός σου πονηρός',
        lang: 'grc',
        translit: 'ophthalmos sou ponēros',
        gloss: 'jicho lako ovu',
      },
    });
    expect(agathos?.anchor).toBe('mkarimu');
    expect(shown.claims.map((claim: PassageClaim) => claim.text)).toEqual(
      translation.claims.map((claim: TranslatedClaim) => claim.text),
    );
    expect(shown.claims.map((claim: PassageClaim) => claim.sourceIds)).toEqual(
      source.claims.map((claim: PassageClaim) => claim.sourceIds),
    );
    expect(shown.sources).toEqual(source.sources);
    // The review is the translation's: the date next to Kiswahili notes is when the Kiswahili was approved.
    expect(shown.review).toEqual({
      status: 'approved',
      method: 'human',
      reviewers: ['fixture-reviewer'],
      approvedVia: 'label',
      lastReviewedAt: '2026-10-05T09:00:00Z',
    });
    const undated = {
      ...translation,
      review: { status: 'approved' as const, method: 'human' as const, reviewers: ['r'], approvedVia: 'cli' as const },
    };
    expect(overlayTranslation(source, undated).review).not.toHaveProperty('lastReviewedAt');
    const pending = { ...translation, review: { status: 'pending' as const, reviewers: [] } };
    expect(overlayTranslation(source, pending).review).toEqual(source.review);
    expect(shown.key).toBe(source.key);
    expect(shown.ref).toBe(source.ref);
    // The English passage itself is untouched.
    expect(source.locale).toBe('en');
  });

  it('keeps the English anchor, note or claim where the translation has none', () => {
    const translation = kiswahili();
    const [first] = translation.translationNotes;
    translation.translationNotes = [{ id: 'v15-evil-eye', gloss: first?.gloss ?? '', summary: 's', body: 'b [c3]' }];
    translation.claims = translation.claims.slice(1);
    const shown = overlayTranslation(english(), translation);
    expect(shown.translationNotes[0]?.anchor).toBe('envious');
    expect(shown.translationNotes[1]).toEqual(english().translationNotes[1]);
    expect(shown.claims[0]?.text).toBe(english().claims[0]?.text);
  });
});

describe('overlaySource', () => {
  it('finds the English passage and translation behind an overlay, and behind an unchanged copy of it', () => {
    const source = english();
    const translation = kiswahili();
    const shown = overlayTranslation(source, translation);
    expect(overlaySource(shown)).toEqual({ english: source, translation });
    // #265: the sw mirror must not fall back to empty segments when a page copies the overlaid passage.
    const spread = { ...shown };
    const cloned = structuredClone(shown);
    expect(overlaySource(spread)?.translation).toBe(translation);
    expect(overlaySource(cloned)?.english).toBe(source);
    expect(overlaySource(cloned)).toBe(overlaySource(cloned));
  });

  it('has none for the English passage, an edited copy, or a passage it never laid over', () => {
    const source = english();
    const shown = overlayTranslation(source, kiswahili());
    expect(overlaySource(source)).toBeUndefined();
    expect(overlaySource({ ...shown, summary: 'Muhtasari mwingine.' })).toBeUndefined();
    expect(overlaySource({ ...shown, key: 'MT.1.1-17' })).toBeUndefined();
  });
});

describe('passageInLocale', () => {
  it('shows a fresh, approved translation', () => {
    const { passage, status } = passageInLocale(english(), kiswahili());
    expect(status).toBe('translated');
    expect(passage.locale).toBe('sw');
    expect(passage.summary).toBe(kiswahili().summary);
  });

  it('falls back to the English notes for a stale translation', () => {
    const changed = english();
    changed.context.title = 'Labourers in a vineyard';
    const { passage, status } = passageInLocale(changed, kiswahili());
    expect(status).toBe('stale');
    expect(passage).toBe(changed);
    expect(passage.locale).toBe('en');
  });

  it('falls back to the English notes for a missing or pending translation', () => {
    expect(passageInLocale(english(), null)).toMatchObject({ status: 'missing', passage: { locale: 'en' } });
    const pending = { ...kiswahili(), review: { status: 'pending' as const, reviewers: [] } };
    expect(passageInLocale(english(), pending)).toMatchObject({ status: 'unapproved', passage: { locale: 'en' } });
  });
});

/** An in-memory file system over `files` (path relative to `/repo` → text). */
function memoryFs(files: Readonly<Record<string, string>>, failWith?: Error): ContentFs {
  return {
    readFile: (path) => {
      if (failWith !== undefined) throw failWith;
      const text = files[path.replace(/^\/repo\//, '')];
      if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return text;
    },
    readdir: () => [],
  };
}

describe('translationSource', () => {
  it('reads and validates a translation once, and returns null when there is none', () => {
    const fs = memoryFs({ 'passages/i18n/sw/MT.20.1-16.json': JSON.stringify(kiswahili()) });
    const spy = vi.spyOn(fs, 'readFile');
    const source = translationSource('/repo', fs);
    expect(source('sw', 'MT.20.1-16')?.summary).toBe(kiswahili().summary);
    expect(source('sw', 'MT.20.1-16')?.locale).toBe('sw');
    expect(source('sw', 'IS.55.6-9')).toBeNull();
    expect(source('sw', 'IS.55.6-9')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('fails on an invalid translation or a translation filed under the wrong key', () => {
    const invalid = translationSource('/repo', memoryFs({ 'passages/i18n/sw/MT.20.1-16.json': '{}' }));
    expect(() => invalid('sw', 'MT.20.1-16')).toThrow(ContentError);
    const misfiled = translationSource(
      '/repo',
      memoryFs({ 'passages/i18n/sw/MK.1.1-8.json': JSON.stringify(kiswahili()) }),
    );
    expect(() => misfiled('sw', 'MK.1.1-8')).toThrow(/translationOf/);
  });

  it('passes on file-system errors other than a missing file', () => {
    const source = translationSource('/repo', memoryFs({}, Object.assign(new Error('EACCES'), { code: 'EACCES' })));
    expect(() => source('sw', 'MT.20.1-16')).toThrow('EACCES');
  });
});

describe('localeRepo over the fixture content root', () => {
  const repo = openRepo(contentRoot);

  it('is the repository itself for the default locale', () => {
    expect(localeRepo(repo, 'en')).toBe(repo);
    expect(localeRepo(repo, 'sw', { defaultLocale: 'sw' })).toBe(repo);
  });

  it('shows the approved Kiswahili notes of Mt 20 on every path a page reads', () => {
    const sw = localeRepo(repo, 'sw');
    expect(sw.passage('MT.20.1-16')?.locale).toBe('sw');
    expect(sw.passage('MT.20.1-16')).toBe(sw.passage('MT.20.1-16'));
    const day = sw.resolveDay('2026-09-20');
    const gospel = day === null ? undefined : readingsBySlot(day).get('gospel');
    expect(gospel?.passage?.summary).toBe(kiswahili().summary);
    expect(gospel?.approved).toBe(true);
    const [listedDay] = sw.listDays('2026-09-20', '2026-09-20');
    const listed = listedDay === undefined ? undefined : readingsBySlot(listedDay).get('gospel');
    expect(listed?.passage?.locale).toBe('sw');
  });

  it('leaves a pending passage alone (it stays unpublished) and passes the rest through', () => {
    const sw = localeRepo(repo, 'sw');
    expect(sw.passage('IS.55.6-9')).toBe(repo.passage('IS.55.6-9'));
    expect(sw.passage('NOT.1.1')).toBeNull();
    expect(sw.resolveDay('1999-01-01')).toBeNull();
    expect(sw.root).toBe(repo.root);
    expect(sw.years()).toEqual(repo.years());
    expect(sw.calendarYear(2026)).toBe(repo.calendarYear(2026));
    expect(sw.passageKeys()).toEqual(repo.passageKeys());
    expect(sw.datesForPassage('MT.20.1-16')).toEqual(repo.datesForPassage('MT.20.1-16'));
  });

  it('shows the English notes, marked en, where the translation is missing or stale', () => {
    const missing = localeRepo(repo, 'sw', { translations: () => null });
    expect(missing.passage('MT.20.1-16')?.locale).toBe('en');
    const stale = localeRepo(repo, 'sw', { translations: () => ({ ...kiswahili(), sourceSha256: '0'.repeat(64) }) });
    expect(stale.passage('MT.20.1-16')?.summary).toBe(english().summary);
  });
});

describe('siteRepo', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the build repository as each locale reads it, opened once per locale', () => {
    vi.stubEnv('LECTIO_CONFIG', 'apps/web/test/lectio.config.fixture.json');
    vi.stubEnv('INIT_CWD', webRoot);
    const sw = siteRepo('sw');
    expect(siteRepo('sw')).toBe(sw);
    expect(sw.passage('MT.20.1-16')?.locale).toBe('sw');
    expect(siteRepo('en').passage('MT.20.1-16')?.locale).toBe('en');
  });
});

describe('refLabelIn', () => {
  it('writes references in full with each locale’s book names', () => {
    expect(refLabelIn('en', 'Mt 20:1-16a')).toBe('Matthew 20:1–16a');
    expect(refLabelIn('sw', 'Mt 20:1-16a')).toBe('Mathayo 20:1–16a');
    expect(refLabelIn('sw', 'Ps 145:2-3, 8-9')).toBe('Zaburi 145:2–3, 8–9');
    expect(refLabelIn('sw', '1 Cor 13:4')).toBe('1 Wakorintho 13:4');
    expect(refLabelIn('sw', 'not a ref')).toBe('not a ref');
  });

  it('names numbered books by their written form', () => {
    expect(swahiliBookName('MT')).toBe('Mathayo');
    expect(swahiliBookName('1COR')).toBe('1 Wakorintho');
    expect(swahiliBookName('ACTS')).toBe('Matendo ya Mitume');
  });
});
