import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { openRepo } from '@lectio/content';
import type { ResolvedDay } from '@lectio/content';
import type { Passage } from '@lectio/schema/passage';

import { NARRATION_STRINGS, buildSegments, narrationStrings, passagesOf } from './segments.ts';
import type { NarrationDay, NarrationStrings } from './segments.ts';

const REPO = fileURLToPath(new URL('fixtures/repo', import.meta.url));
const repo = openRepo(REPO);

function seedDay(): ResolvedDay {
  const day = repo.resolveDay('2026-09-20');
  if (day === null) throw new Error('fixture day missing');
  return day;
}

function mt20(): Passage {
  const passage = repo.passage('MT.20.1-16');
  if (passage === null) throw new Error('fixture passage missing');
  return structuredClone(passage);
}

const GOSPEL_DAY: NarrationDay = { masses: [{ id: 'day', readings: [{ slot: 'gospel', key: 'MT.20.1-16' }] }] };

describe('buildSegments on the Mt 20 seed', () => {
  const day = seedDay();
  const segments = buildSegments(day, passagesOf(day), 'en');

  it('gives a context segment plus one per translation note, in order', () => {
    expect(segments.map(({ id, kind, slot }) => ({ id, kind, slot }))).toEqual([
      { id: 'MT.20.1-16/context', kind: 'context', slot: 'gospel' },
      { id: 'MT.20.1-16/note/evil-eye', kind: 'translation-note', slot: 'gospel' },
      { id: 'MT.20.1-16/note/agathos', kind: 'translation-note', slot: 'gospel' },
    ]);
    expect(segments.every((segment) => segment.locale === 'en' && segment.passageKey === 'MT.20.1-16')).toBe(true);
  });

  it('narrates the context with the reference in spoken form', () => {
    const [context] = segments;
    expect(context?.title).toBe('Labourers in the vineyard');
    expect(context?.text).toBe(
      'Context for Matthew chapter 20, verses 1 to 16. Labourers in the vineyard. ' +
        'Matthew alone records this parable, placed between two sayings about the last being first. ' +
        'A denarius was the customary pay for a labourer’s day in first-century Palestine. ' +
        'The owner’s closing question uses the Jewish idiom of the evil eye, an image for begrudging another’s ' +
        'good fortune. Matthew has already set the sound eye against the evil eye in the Sermon on the Mount.',
    );
  });

  it('speaks Greek through the transliteration and references in spoken form', () => {
    expect(segments[1]?.title).toBe('envious · ophthalmos sou ponēros');
    expect(segments[1]?.text).toBe(
      'Translation note on Matthew chapter 20, verse 15, the word “envious”. ' +
        'The Greek is ophthalmos sou ponēros, literally “your eye evil”. ' +
        'Greek asks “is your eye evil?”, an idiom for begrudging another’s good. ' +
        'The evil eye was a familiar image for stinginess and resentment ' +
        '(Deuteronomy chapter 15, verse 9; Proverbs chapter 28, verse 22). ' +
        'English trades the image for an abstract feeling and loses the echo of Matthew chapter 6, verses 22 to 23.',
    );
    expect(segments[2]?.text).toContain('in Matthew chapter 19, verse 17, a few verses earlier.');
  });

  it('contains no claim markers, URLs or original-language script', () => {
    for (const { text, title } of segments) {
      expect(`${title} ${text}`).not.toMatch(/\[c\d+\]|https?:|www\.|[\p{Script=Greek}\p{Script=Hebrew}]/u);
    }
  });

  it('narrates only Lectio’s own notes: every sentence comes from the passage file or the narration strings', () => {
    const passage = mt20();
    const allowed = [
      passage.context.title,
      ...passage.context.paragraphs,
      ...passage.translationNotes.flatMap((n) => [n.summary, n.body, n.anchor, n.original.gloss, n.original.translit]),
    ].join(' ');
    // Content words of the narration must already be in the notes (or be connecting/spoken-reference words).
    const connecting = new Set([
      'context',
      'for',
      'chapter',
      'verse',
      'verses',
      'to',
      'translation',
      'note',
      'on',
      'the',
      'word',
      'is',
      'literally',
      'greek',
      'matthew',
      'deuteronomy',
      'proverbs',
    ]);
    const words = (text: string): string[] => text.toLowerCase().match(/\p{L}+/gu) ?? [];
    const known = new Set(words(allowed));
    for (const { text } of segments) {
      expect(words(text).filter((word) => !known.has(word) && !connecting.has(word))).toEqual([]);
    }
  });

  it('skips passages that are pending review, unless asked', () => {
    expect(segments.some((segment) => segment.passageKey === 'IS.55.6-9')).toBe(false);
    const all = buildSegments(day, passagesOf(day), 'en', { includeUnapproved: true });
    expect(all.map((segment) => segment.id)).toEqual([
      'IS.55.6-9/context',
      'MT.20.1-16/context',
      'MT.20.1-16/note/evil-eye',
      'MT.20.1-16/note/agathos',
    ]);
    expect(all[0]).toMatchObject({ slot: 'first-reading', title: 'Seek the Lord while he may be found' });
    expect(all[0]?.text).toMatch(
      /^Context for Isaiah chapter 55, verses 6 to 9\. Seek the Lord while he may be found\. /,
    );
  });

  it('is deterministic', () => {
    expect(buildSegments(day, passagesOf(day), 'en')).toEqual(segments);
  });
});

describe('buildSegments inputs and options', () => {
  it('accepts passages as a list or a map, and skips missing ones', () => {
    const passage = mt20();
    const fromList = buildSegments(GOSPEL_DAY, [passage], 'en');
    expect(fromList).toHaveLength(3);
    expect(buildSegments(GOSPEL_DAY, new Map([['MT.20.1-16', passage]]), 'en')).toEqual(fromList);
    expect(buildSegments(GOSPEL_DAY, new Map([['MT.20.1-16', null]]), 'en')).toEqual([]);
    expect(buildSegments(GOSPEL_DAY, [], 'en')).toEqual([]);
  });

  it('narrates a passage read twice in one day once, under its first slot', () => {
    const day: NarrationDay = {
      masses: [
        { id: 'vigil', readings: [{ slot: 'gospel', key: 'MT.20.1-16' }] },
        { id: 'day', readings: [{ slot: 'second-reading', key: 'MT.20.1-16' }] },
      ],
    };
    const segments = buildSegments(day, [mt20()], 'en');
    expect(segments.map((segment) => segment.slot)).toEqual(['gospel', 'gospel', 'gospel']);
    expect(buildSegments(day, [mt20()], 'en', { massId: 'day' }).map((segment) => segment.slot)).toEqual([
      'second-reading',
      'second-reading',
      'second-reading',
    ]);
    expect(buildSegments(day, [mt20()], 'en', { massId: 'none' })).toEqual([]);
  });

  it('skips passages written in another locale', () => {
    const passage = { ...mt20(), locale: 'sw' };
    expect(buildSegments(GOSPEL_DAY, [passage], 'en')).toEqual([]);
  });

  it('keeps note segments identical whatever day or slot they are read on', () => {
    const other: NarrationDay = { masses: [{ id: 'x', readings: [{ slot: 'reading-3', key: 'MT.20.1-16' }] }] };
    const a = buildSegments(GOSPEL_DAY, [mt20()], 'en');
    const b = buildSegments(other, [mt20()], 'en');
    expect(b.map(({ id, text, title }) => ({ id, text, title }))).toEqual(
      a.map(({ id, text, title }) => ({ id, text, title })),
    );
  });

  it('falls back to the passage key when the printed reference does not parse', () => {
    const passage = { ...mt20(), ref: 'Gospel of the day' };
    expect(buildSegments(GOSPEL_DAY, [passage], 'en')[0]?.text).toMatch(
      /^Context for Matthew chapter 20, verses 1 to 16\./,
    );
  });

  it('says "words" for a multi-word anchor and drops a note part that has nothing speakable', () => {
    const passage = mt20();
    const [note] = passage.translationNotes;
    if (note === undefined) throw new Error('fixture note missing');
    passage.translationNotes = [{ ...note, anchor: 'be envious', summary: 'λόγος' }];
    const [, segment] = buildSegments(GOSPEL_DAY, [passage], 'en');
    expect(segment?.text).toMatch(
      /^Translation note on Matthew chapter 20, verse 15, the words “be envious”\. The Greek is ophthalmos sou ponēros, literally “your eye evil”\. The evil eye/,
    );
  });

  it('uses Hebrew, Aramaic and Latin language names', () => {
    const passage = mt20();
    const [note] = passage.translationNotes;
    if (note === undefined) throw new Error('fixture note missing');
    passage.translationNotes = (['hbo', 'arc', 'lat'] as const).map((lang, i) => ({
      ...note,
      id: `n${String(i)}`,
      original: { ...note.original, lang },
    }));
    const texts = buildSegments(GOSPEL_DAY, [passage], 'en')
      .slice(1)
      .map((segment) => segment.text);
    expect(texts.map((text) => /The (\w+) is/.exec(text)?.[1])).toEqual(['Hebrew', 'Aramaic', 'Latin']);
  });

  it('narrates a single-chapter book’s verses without a chapter', () => {
    const passage: Passage = {
      ...mt20(),
      key: 'JUDE.1.17-25',
      ref: 'Jude 17, 20b-25',
      translationNotes: mt20().translationNotes.map((note) => ({ ...note, verse: '1:20' })),
    };
    const day: NarrationDay = { masses: [{ id: 'day', readings: [{ slot: 'first-reading', key: 'JUDE.1.17-25' }] }] };
    const [context, note] = buildSegments(day, [passage], 'en');
    expect(context?.text).toMatch(/^Context for Jude, verses 17 and 20 to 25\./);
    expect(note?.text).toMatch(/^Translation note on Jude, verse 20,/);
  });

  it('accepts custom narration strings', () => {
    const strings: NarrationStrings = {
      languages: { grc: 'Kigiriki', hbo: 'Kiebrania', arc: 'Kiaramu', lat: 'Kilatini' },
      contextIntro: (ref, title) => `[${ref}|${title}]`,
      noteIntro: ({ verse, language }) => `<${verse}|${language}>`,
      noteTitle: (anchor) => anchor.toUpperCase(),
    };
    const passage = { ...mt20(), locale: 'sw' };
    const segments = buildSegments(GOSPEL_DAY, [passage], 'sw', { strings });
    expect(segments[0]?.text.startsWith('[Matthew chapter 20, verses 1 to 16|Labourers in the vineyard] ')).toBe(true);
    expect(segments[1]?.text.startsWith('<Matthew chapter 20, verse 15|Kigiriki> ')).toBe(true);
    expect(segments[1]?.title).toBe('ENVIOUS');
  });
});

describe('narrationStrings', () => {
  it('finds English, falls back from a region to the language, and rejects unknown locales', () => {
    expect(narrationStrings('en')).toBe(NARRATION_STRINGS.en);
    expect(narrationStrings('en-KE')).toBe(NARRATION_STRINGS.en);
    expect(() => narrationStrings('sw')).toThrow(RangeError);
    expect(() => buildSegments(GOSPEL_DAY, [mt20()], 'sw')).toThrow('No narration strings for locale "sw"');
  });
});

describe('passagesOf', () => {
  it('collects the passages a resolved day has, skipping readings without one', () => {
    expect(passagesOf(seedDay()).map((passage) => passage.key)).toEqual(['IS.55.6-9', 'MT.20.1-16']);
  });
});
