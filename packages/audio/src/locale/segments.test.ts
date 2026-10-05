import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { openRepo } from '@lectio/content';
import type { Passage } from '@lectio/schema/passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import { buildSegments } from '../script/segments.ts';
import type { NarrationDay } from '../script/segments.ts';
import { loadTranslations } from './repo.ts';
import { LOCALE_NARRATION, buildLocaleSegments, localeNarration, skipReason } from './segments.ts';
import type { LocaleNarration } from './segments.ts';

const repo = openRepo(fileURLToPath(new URL('fixtures/repo', import.meta.url)));

function mt20(): Passage {
  return structuredClone(repo.passage('MT.20.1-16') as Passage);
}

function is55(): Passage {
  return structuredClone(repo.passage('IS.55.6-9') as Passage);
}

function swahili(key = 'MT.20.1-16'): TranslatedPassage {
  const found = loadTranslations(repo, 'sw').find((translation) => translation.translationOf === key);
  return structuredClone(found as TranslatedPassage);
}

const DAY: NarrationDay = {
  masses: [
    { id: 'vigil', readings: [{ slot: 'first-reading', key: 'IS.55.6-9' }] },
    {
      id: 'day',
      readings: [
        { slot: 'first-reading', key: 'IS.55.6-9' },
        { slot: 'gospel', key: 'MT.20.1-16' },
        { slot: 'psalm', key: 'MT.20.1-16' },
        { slot: 'second-reading', key: 'PHIL.1.20-24_1.27' },
      ],
    },
  ],
};

describe('localeNarration', () => {
  it('has Kiswahili, also for a regional tag', () => {
    expect(localeNarration('sw')).toBe(LOCALE_NARRATION['sw']);
    expect(localeNarration('sw-KE')).toBe(LOCALE_NARRATION['sw']);
  });

  it('throws for a language without narration', () => {
    expect(() => localeNarration('fr')).toThrow(/No narration for locale "fr"/);
  });
});

describe('skipReason', () => {
  it('lets an approved, fresh translation of an approved passage through', () => {
    expect(skipReason(mt20(), swahili())).toBeNull();
  });

  it('needs the English passage, approved', () => {
    expect(skipReason(undefined, swahili())).toBe('missing-source');
    expect(skipReason(null, swahili())).toBe('missing-source');
    expect(skipReason(is55(), swahili('IS.55.6-9'))).toBe('source-unapproved');
  });

  it('needs the translation approved', () => {
    const pending = { ...swahili(), review: { status: 'pending', reviewers: [] } } as TranslatedPassage;
    expect(skipReason(mt20(), pending)).toBe('unapproved');
    expect(skipReason(mt20(), pending, { includeUnapproved: true })).toBeNull();
    expect(skipReason(is55(), swahili('IS.55.6-9'), { includeUnapproved: true })).toBeNull();
  });

  it('never narrates a stale translation, even when unapproved ones are allowed', () => {
    const english = mt20();
    (english.claims[0] as { text: string }).text = 'Reworded since the translation.';
    expect(skipReason(english, swahili())).toBe('stale');
    expect(skipReason(english, swahili(), { includeUnapproved: true })).toBe('stale');
  });

  it('refuses a translation that does not line up with the English notes', () => {
    const translation = swahili();
    translation.translationNotes = translation.translationNotes.slice(1);
    expect(skipReason(mt20(), translation)).toBe('mismatch');
  });
});

describe('buildLocaleSegments', () => {
  const passages = [mt20(), is55()];
  const translations = loadTranslations(repo, 'sw');
  const segments = buildLocaleSegments(DAY, passages, translations, 'sw');

  it('narrates the translated notes in Kiswahili, under the English segment ids', () => {
    const english = buildSegments(DAY, passages, 'en');
    expect(segments.map(({ id, slot, locale }) => ({ id, slot, locale }))).toEqual([
      { id: 'MT.20.1-16/context', slot: 'gospel', locale: 'sw' },
      { id: 'MT.20.1-16/note/evil-eye', slot: 'gospel', locale: 'sw' },
      { id: 'MT.20.1-16/note/agathos', slot: 'gospel', locale: 'sw' },
    ]);
    expect(segments.map((segment) => segment.id)).toEqual(english.map((segment) => segment.id));
    expect(segments.every((segment) => segment.kind === english.find((e) => e.id === segment.id)?.kind)).toBe(true);
  });

  it('speaks the context with the reference in Kiswahili and no claim markers', () => {
    expect(segments[0]?.title).toBe('Wafanyakazi katika shamba la mizabibu');
    expect(segments[0]?.text).toMatch(
      /^Muktadha wa Mathayo sura ya 20, mistari ya 1 hadi 16\. Wafanyakazi katika shamba la mizabibu\. Mathayo peke yake/,
    );
    expect(segments[0]?.text).not.toMatch(/\[c\d\]/);
  });

  it('speaks a note: the localised anchor, the English transliteration and Kiswahili book names', () => {
    expect(segments[1]?.title).toBe('wivu · ophthalmos sou ponēros');
    expect(segments[1]?.text).toBe(
      'Maelezo ya tafsiri kuhusu Mathayo sura ya 20, mstari wa 15, neno “wivu”. ' +
        'Kwa Kigiriki ni ophthalmos sou ponēros, maana yake halisi “jicho lako ovu”. ' +
        'Kigiriki kinauliza “je, jicho lako ni ovu?”, nahau ya kuonea wivu mema ya mwingine. ' +
        'Jicho ovu lilikuwa picha inayojulikana ya ubahili na kinyongo (Kumbukumbu la Torati sura ya 15, mstari wa 9; ' +
        'Mithali sura ya 28, mstari wa 22). Tafsiri inabadilisha picha hiyo kuwa hisia tu na kupoteza mwangwi wa ' +
        'Mathayo sura ya 6, mistari ya 22 hadi 23.',
    );
  });

  it('introduces a note without a localised anchor by its transliteration only', () => {
    expect(segments[2]?.title).toBe('agathos');
    expect(segments[2]?.text).toMatch(/^Maelezo ya tafsiri kuhusu Mathayo sura ya 20, mstari wa 15\. Kwa Kigiriki/);
    expect(segments[2]?.text).toContain('katika Mathayo sura ya 19, mstari wa 17,');
  });

  it('includes pending passages and translations on request', () => {
    const all = buildLocaleSegments(DAY, passages, translations, 'sw', { includeUnapproved: true });
    expect(all.map(({ id, slot }) => `${slot}:${id}`)).toEqual([
      'first-reading:IS.55.6-9/context',
      'gospel:MT.20.1-16/context',
      'gospel:MT.20.1-16/note/evil-eye',
      'gospel:MT.20.1-16/note/agathos',
    ]);
    expect(all[0]?.text).toBe(
      'Muktadha wa Isaya sura ya 55, mistari ya 6 hadi 9. Mtafuteni Bwana maadamu anapatikana. ' +
        'Mistari hii inafunga kitabu cha faraja kilichoandikiwa walio uhamishoni Babeli.',
    );
  });

  it('keeps to one Mass, takes lookups by key and skips other locales and missing passages', () => {
    const byKey = new Map(translations.map((translation) => [translation.translationOf, translation]));
    const vigil = buildLocaleSegments(DAY, new Map([['IS.55.6-9', is55()]]), byKey, 'sw', {
      massId: 'vigil',
      includeUnapproved: true,
    });
    expect(vigil.map((segment) => segment.id)).toEqual(['IS.55.6-9/context']);
    expect(buildLocaleSegments(DAY, [], translations, 'sw', { includeUnapproved: true })).toEqual([]);
    const other = translations.map((translation) => ({ ...translation, locale: 'sw-KE' }));
    expect(buildLocaleSegments(DAY, passages, other, 'sw')).toEqual([]);
    expect(buildLocaleSegments(DAY, passages, other, 'sw-KE').map((segment) => segment.locale)).toEqual([
      'sw-KE',
      'sw-KE',
      'sw-KE',
    ]);
  });

  it('falls back to the passage key when the printed reference does not parse', () => {
    const english = { ...mt20(), ref: 'not a reference' };
    const [context] = buildLocaleSegments(DAY, [english], translations, 'sw');
    expect(context?.text.startsWith('Muktadha wa Mathayo sura ya 20, mistari ya 1 hadi 16.')).toBe(true);
  });

  it('takes another narration', () => {
    const narration: LocaleNarration = {
      strings: { ...(LOCALE_NARRATION['sw'] as LocaleNarration).strings, contextIntro: () => 'INTRO' },
      speakReferences: (text) => text,
    };
    const [context, evilEye] = buildLocaleSegments(DAY, passages, translations, 'sw', { narration });
    expect(context?.text.startsWith('INTRO Mathayo peke yake')).toBe(true);
    expect(evilEye?.text).toContain('(Kum 15:9; Mit 28:22)');
  });
});
