/**
 * Kiswahili narration: the connecting words of a segment, scripture references said in Kiswahili
 * (`Mathayo sura ya 20, mistari ya 1 hadi 16`) and references written with Kiswahili book names in
 * the prose (`Mathayo 6:22`, `Kum 15:9`), which the English matcher of `../script/text.ts` cannot see.
 */
import { chapterLabel, checkRef, getBook, tryParseRef } from '@lectio/refs';
import type { Ref, Segment } from '@lectio/refs';

import type { NarrationStrings } from '../script/segments.ts';
import { asSentence } from '../script/text.ts';
import type { SpokenRef } from '../script/text.ts';
import { SWAHILI_BOOKS, findSwahiliBook, swahiliBookNames } from './books.ts';

/** Whether a segment must say its chapter: always, unless it continues the previous segment's chapter. */
function saysChapter(singleChapter: boolean, segment: Segment, previous: Segment | undefined): boolean {
  if (singleChapter) return false;
  return previous?.end.v === undefined || previous.end.c !== segment.start.c;
}

function list(items: readonly string[]): string {
  return items.length === 1 ? `${items[0]}` : `${items.slice(0, -1).join(', ')} na ${items.at(-1)}`;
}

/**
 * Kiswahili spoken references: `Mathayo sura ya 20, mistari ya 1 hadi 16`, `Zaburi ya 23, mstari wa 1`,
 * `Yuda, mstari wa 3`. Like the English form, sub-verse letters (`16a`) are dropped.
 */
export const swahiliSpokenRef: SpokenRef = (ref: Ref) => {
  const book = checkRef(ref);
  const psalm = book.code === 'PS';
  const label = (c: number): string => chapterLabel(book.code, c);
  const chapter = (c: number): string => (psalm ? `Zaburi ya ${label(c)}` : `sura ya ${label(c)}`);
  const groups: { header: string; items: string[]; plural: boolean }[] = [];
  ref.segments.forEach((segment, i) => {
    const { start, end } = segment;
    if (start.v === undefined) {
      const header = start.c === end.c ? chapter(start.c) : `${chapter(start.c)} hadi ya ${label(end.c)}`;
      groups.push({ header, items: [], plural: false });
      return;
    }
    const current = groups.at(-1);
    const group =
      current && !saysChapter(book.singleChapter, segment, ref.segments[i - 1])
        ? current
        : { header: book.singleChapter ? '' : chapter(start.c), items: [], plural: false };
    if (group !== current) groups.push(group);
    if (start.c !== end.c) group.items.push(`${String(start.v)} hadi ${chapter(end.c)}, mstari wa ${String(end.v)}`);
    else if (start.v === end.v) group.items.push(String(start.v));
    else {
      group.items.push(`${String(start.v)} hadi ${String(end.v)}`);
      group.plural = true;
    }
    if (group.items.length > 1) group.plural = true;
  });
  const text = groups
    .map(({ header, items, plural }) => {
      if (items.length === 0) return header;
      const verses = `${plural ? 'mistari ya' : 'mstari wa'} ${list(items)}`;
      return header === '' ? verses : `${header}, ${verses}`;
    })
    .join('; ');
  if (psalm) return text;
  const name = SWAHILI_BOOKS[book.code].spoken;
  return book.singleChapter ? `${name}, ${text}` : `${name} ${text}`;
};

/** Chapter and verse (`22:1`, `16a`, `1-16`, `9-12:8`), or a bare verse when `verse` is optional. */
const refPart = (sep: '' | '?') =>
  String.raw`\d{1,3}(?:[:.]\d{1,3})${sep}[a-g]?(?:[-–—]\d{1,3}(?:[:.]\d{1,3})?[a-g]?)?(?![\d:])`;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Written book names that are also people's names: `Yuda` is Jude, but also Judas (Iscariot, or Jude the apostle),
 * so `Yuda 12` may not be a reference at all. With a chapter alone they are left as prose; `Yuda 1:12` and the
 * abbreviation `Yud 12` are still references.
 */
const PERSONAL_NAMES: ReadonlySet<string> = new Set(['Yuda']);

/** A Kiswahili book name or abbreviation (optional full stop), then chapter and verses, with further parts. */
const SWAHILI_PROSE_REF = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(` +
    swahiliBookNames()
      .map((name) => escapeRegExp(name).replace(/^([1-3]) /, '$1 ?'))
      .join('|') +
    String.raw`)\.? (${refPart('?')}(?:, ?${refPart('?')}(?! ?\p{Lu})|; ?${refPart('')})*)`,
  'gu',
);

/**
 * Rewrites references written with Kiswahili book names to their spoken form through `spokenRef`
 * (Kiswahili by default): `(Kum 15:9; Mit 28:22)` → `(Kumbukumbu la Torati sura ya 15, mstari wa 9;
 * Mithali sura ya 28, mstari wa 22)`. As in English, a chapter alone counts only for a one-chapter
 * book or a psalm (and not after a name that is also a person's, `Yuda 3`), a trailing part that does not parse is left as prose, and anything else that does
 * not parse is left as written.
 */
export function speakSwahiliReferences(text: string, spokenRef: SpokenRef = swahiliSpokenRef): string {
  return text.replace(SWAHILI_PROSE_REF, (match: string, name: string, passage: string) => {
    // The pattern is built from the book table, so every matched name has a book.
    const code = findSwahiliBook(name) as NonNullable<ReturnType<typeof findSwahiliBook>>;
    if (!passage.includes(':') && !passage.includes('.')) {
      const chapterAlone = (getBook(code).singleChapter && !PERSONAL_NAMES.has(name)) || code === 'PS';
      if (!chapterAlone) return match;
    }
    let parts = passage;
    for (;;) {
      const parsed = tryParseRef(`${code} ${parts}`);
      if (parsed.ok) return `${spokenRef(parsed.value)}${passage.slice(parts.length)}`;
      const cut = Math.max(parts.lastIndexOf(','), parts.lastIndexOf(';'));
      if (cut < 0) return match;
      parts = parts.slice(0, cut);
    }
  });
}

/** Kiswahili connecting words. A translation without a localised anchor is introduced without one. */
export const SWAHILI_STRINGS: NarrationStrings = {
  languages: { grc: 'Kigiriki', hbo: 'Kiebrania', arc: 'Kiaramu', lat: 'Kilatini' },
  contextIntro: (ref, title) => `Muktadha wa ${ref}. ${asSentence(title)}`,
  noteIntro: ({ verse, anchor, language, translit, gloss }) => {
    const word = anchor === '' ? '' : `, ${anchor.includes(' ') ? 'maneno' : 'neno'} “${anchor}”`;
    return `Maelezo ya tafsiri kuhusu ${verse}${word}. Kwa ${language} ni ${translit}, maana yake halisi “${gloss}”.`;
  },
  noteTitle: (anchor, translit) => (anchor === '' ? translit : `${anchor} · ${translit}`),
  spokenRef: swahiliSpokenRef,
};
