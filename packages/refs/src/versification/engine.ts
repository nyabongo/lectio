import { BOOKS, isBookCode } from '../books.ts';
import type { BookCode } from '../books.ts';
import type { VerseCountLookup, VerseId } from '../enumerate.ts';
import { enumerateVerses } from '../enumerate.ts';
import { chapterLabel, isLetteredChapter } from '../greek-esther.ts';
import { fromKey } from '../key.ts';
import type { Point, Ref, Segment } from '../types.ts';
import { checkRef } from '../validate.ts';
import { VersificationError } from './errors.ts';
import { GREEK_ADDITION_BOOKS, SCHEMES } from './schemes.ts';
import type { Scheme, SchemeDefinition, Span } from './schemes.ts';
import { parseVrs, sourceKey } from './vrs.ts';
import type { SourceVerse, VrsFile } from './vrs.ts';

/** The inputs of {@link createVersification}: `.vrs` texts by name and how each scheme uses them. */
export interface VersificationData {
  readonly texts: Readonly<Record<string, string>>;
  readonly schemes: Readonly<Record<Scheme, SchemeDefinition>>;
}

/** Anything {@link Versification.isRealVerse} accepts: a passage key, a parsed reference or one verse. */
export type VerseInput = string | Ref | VerseId;

export interface Versification {
  /**
   * Number of chapters of `book` in the scheme (0 if the scheme lacks the book). Esther's lettered
   * chapters A–F (`original` only, chapters 101-106) are not counted: `EST` has 10.
   */
  chapterCount(book: BookCode, scheme?: Scheme): number;
  /**
   * Last verse number of a chapter, or `undefined` if the chapter does not exist. It is a verse
   * number, not a count: a chapter may start after verse 1 (see {@link firstVerse}).
   */
  chapterLength(book: BookCode, chapter: number, scheme?: Scheme): number | undefined;
  /**
   * First verse number of a chapter, or `undefined` if the chapter does not exist. Usually 1; the
   * Stuttgart numbering of the `vulgate` scheme starts Ps 115 at verse 10 and Ps 147 at verse 12,
   * so Vulgate Ps 115 is verses 10-19: `chapterLength` 19, `firstVerse` 10, ten verses. Thirteen
   * `lxx` chapters start later too (1 Sm 13 and 18, 1 Kgs 3 and 14, Prv 16 and 19, Sir 6, Jer 2, 7,
   * 17, 26, 32 and 34); `mapRef` maps a whole chapter onto one of them as the whole chapter.
   */
  firstVerse(book: BookCode, chapter: number, scheme?: Scheme): number | undefined;
  /** {@link chapterLength} as the lookup `enumerateVerses` takes. */
  verseCounts(scheme?: Scheme): VerseCountLookup;
  /**
   * True when the verse, or every endpoint and whole chapter of the reference,
   * exists in the scheme. A string must be a canonical passage key; anything
   * malformed is simply not real.
   */
  isRealVerse(input: VerseInput, scheme?: Scheme): boolean;
  /** The corresponding verse in `to`. Many-to-one mappings return the first verse listed upstream. */
  mapVerse(verse: VerseId, from: Scheme, to: Scheme): VerseId;
  /**
   * The reference in `to`, segment by segment. A segment splits when its
   * verses stop being consecutive in `to`; verses with no counterpart are
   * dropped (an error only if nothing is left). Sub-verse letters are dropped.
   * A whole-chapter segment stays whole-chapter when it maps onto whole chapters.
   */
  mapRef(ref: Ref, from: Scheme, to: Scheme): Ref;
  /** True for the Greek additions to Daniel (3:24-90, 13, 14), which have no Hebrew or Aramaic original. */
  notInOriginal(verse: VerseId, scheme?: Scheme): boolean;
  /** The verse as the underlying `.vrs` file numbers it (`DN 3:91` in `original` → `DAN 3:24`). */
  toSourceVerse(verse: VerseId, scheme?: Scheme): SourceVerse;
  /** The Lectio verse for a `.vrs` verse of the scheme, or `undefined` if there is none. */
  fromSourceVerse(verse: SourceVerse, scheme?: Scheme): VerseId | undefined;
}

interface ResolvedSpan {
  readonly from: number;
  readonly to: number;
  readonly book: string;
  readonly sc: number;
  /** Source verse minus Lectio verse. */
  readonly shift: number;
}

interface BookTable {
  /** Index 0 is chapter 1; an empty list means the chapter does not exist. */
  readonly chapters: readonly (readonly ResolvedSpan[])[];
  /** Esther's lettered chapters (A–F, stored as 101–106), kept out of the chapter count. */
  readonly lettered: ReadonlyMap<number, readonly ResolvedSpan[]>;
}

interface SchemeTable {
  readonly file: VrsFile;
  /** The scheme's Lectio supplement (its book lines replace the file's, its mapping lines come first). */
  readonly supplement: VrsFile;
  /** Verses the file or the supplement excludes. */
  readonly excluded: ReadonlySet<string>;
  readonly books: Map<BookCode, BookTable>;
  /** `BOOK c` of a source chapter → the Lectio book and spans that use it. */
  reverse?: Map<string, { book: BookCode; c: number; span: ResolvedSpan }[]>;
  /** Scheme verse → original verse, and back (first listing wins). */
  toOriginal?: Map<string, SourceVerse>;
  fromOriginal?: Map<string, SourceVerse>;
}

const label = (v: VerseId): string => `${v.book} ${chapterLabel(v.book, v.c)}:${v.v}`;
const pointLabel = (book: BookCode, point: Point): string =>
  point.v === undefined
    ? `${book} ${chapterLabel(book, point.c)}`
    : `${book} ${chapterLabel(book, point.c)}:${point.v}`;

/** Builds the versification functions over the given tables. The package's default instance uses the embedded data. */
export function createVersification(data: VersificationData): Versification {
  const tables = new Map<Scheme, SchemeTable>();
  const text = (name: string): string => data.texts[name] ?? '';

  const definition = (scheme: Scheme): SchemeDefinition => {
    if (!SCHEMES.includes(scheme)) {
      throw new VersificationError('UNKNOWN_SCHEME', `Unknown versification scheme "${String(scheme)}"`);
    }
    return data.schemes[scheme];
  };

  const schemeTable = (scheme: Scheme): SchemeTable => {
    const def = definition(scheme);
    let table = tables.get(scheme);
    if (!table) {
      const file = parseVrs(text(def.file));
      const supplement = parseVrs(def.supplement === undefined ? '' : text(def.supplement));
      table = { file, supplement, excluded: new Set([...file.excluded, ...supplement.excluded]), books: new Map() };
      tables.set(scheme, table);
    }
    return table;
  };

  const bookTable = (book: BookCode, scheme: Scheme): BookTable => {
    const table = schemeTable(scheme);
    const cached = table.books.get(book);
    if (cached) return cached;
    const usfm = BOOKS.find((b) => b.code === book)?.usfm ?? book;
    const sourceBook = (id: string): readonly number[] | undefined =>
      table.supplement.books.get(id) ?? table.file.books.get(id);
    const counts = sourceBook(usfm) ?? [];
    const spans: readonly Span[] =
      definition(scheme).layouts[book] ?? counts.map((_, i) => ({ c: i + 1, book: usfm, sc: i + 1 }));
    const chapters: ResolvedSpan[][] = [];
    const lettered = new Map<number, ResolvedSpan[]>();
    for (const span of spans) {
      const sourceLength = sourceBook(span.book)?.[span.sc - 1] ?? 0;
      const from = span.from ?? 1;
      const sv = span.sv ?? 1;
      const count = span.count ?? sourceLength - sv + 1;
      if (count < 1) continue;
      const resolved = { from, to: from + count - 1, book: span.book, sc: span.sc, shift: sv - from };
      if (isLetteredChapter(book, span.c)) {
        lettered.set(span.c, [...(lettered.get(span.c) ?? []), resolved]);
        continue;
      }
      while (chapters.length < span.c) chapters.push([]);
      (chapters[span.c - 1] as ResolvedSpan[]).push(resolved);
    }
    const result: BookTable = { chapters, lettered };
    table.books.set(book, result);
    return result;
  };

  /** The spans of one chapter, numbered or lettered; empty when the chapter does not exist. */
  const spansAt = (book: BookCode, chapter: number, scheme: Scheme): readonly ResolvedSpan[] => {
    const table = bookTable(book, scheme);
    return table.lettered.get(chapter) ?? table.chapters[chapter - 1] ?? [];
  };

  const chapterLength = (book: BookCode, chapter: number, scheme: Scheme = 'original'): number | undefined => {
    const spans = spansAt(book, chapter, scheme);
    return spans.length === 0 ? undefined : Math.max(...spans.map((span) => span.to));
  };

  const chapterCount = (book: BookCode, scheme: Scheme = 'original'): number => bookTable(book, scheme).chapters.length;

  const spanOf = (verse: VerseId, scheme: Scheme): ResolvedSpan | undefined =>
    spansAt(verse.book, verse.c, scheme).find((span) => span.from <= verse.v && verse.v <= span.to);

  const sourceOf = (verse: VerseId, scheme: Scheme): SourceVerse | undefined => {
    const span = spanOf(verse, scheme);
    if (!span) return undefined;
    const source = { book: span.book, c: span.sc, v: verse.v + span.shift };
    return schemeTable(scheme).excluded.has(sourceKey(source)) ? undefined : source;
  };

  const verseExists = (verse: VerseId, scheme: Scheme): boolean =>
    isBookCode(verse.book) &&
    Number.isSafeInteger(verse.c) &&
    Number.isSafeInteger(verse.v) &&
    sourceOf(verse, scheme) !== undefined;

  const firstVerse = (book: BookCode, chapter: number, scheme: Scheme = 'original'): number | undefined => {
    const last = chapterLength(book, chapter, scheme);
    if (last === undefined) return undefined;
    const spans = spansAt(book, chapter, scheme);
    let v = Math.min(...spans.map((span) => span.from));
    while (v < last && !verseExists({ book, c: chapter, v }, scheme)) v += 1;
    return v;
  };

  const fromSourceVerse = (source: SourceVerse, scheme: Scheme = 'original'): VerseId | undefined => {
    const table = schemeTable(scheme);
    if (!table.reverse) {
      const reverse = new Map<string, { book: BookCode; c: number; span: ResolvedSpan }[]>();
      for (const { code } of BOOKS) {
        const { chapters, lettered } = bookTable(code, scheme);
        const all: (readonly [number, readonly ResolvedSpan[]])[] = [
          ...chapters.map((spans, i) => [i + 1, spans] as const),
          ...lettered,
        ];
        for (const [c, spans] of all) {
          for (const span of spans) {
            const key = `${span.book} ${span.sc}`;
            reverse.set(key, [...(reverse.get(key) ?? []), { book: code, c, span }]);
          }
        }
      }
      table.reverse = reverse;
    }
    for (const { book, c, span } of table.reverse.get(`${source.book} ${source.c}`) ?? []) {
      const verse = { book, c, v: source.v - span.shift };
      if (span.from <= verse.v && verse.v <= span.to && verseExists(verse, scheme)) return verse;
    }
    return undefined;
  };

  const mappings = (
    scheme: Scheme,
  ): { toOriginal: Map<string, SourceVerse>; fromOriginal: Map<string, SourceVerse> } => {
    const table = schemeTable(scheme);
    if (!table.toOriginal || !table.fromOriginal) {
      const pairs = [...table.supplement.mappings, ...table.file.mappings];
      const toOriginal = new Map<string, SourceVerse>();
      const fromOriginal = new Map<string, SourceVerse>();
      for (const { from, to } of pairs) {
        // A line about a verse the scheme does not use (another book form, a typo) says nothing about it.
        if (!fromSourceVerse(from, scheme)) continue;
        if (!toOriginal.has(sourceKey(from))) toOriginal.set(sourceKey(from), to);
        if (!fromOriginal.has(sourceKey(to))) fromOriginal.set(sourceKey(to), from);
      }
      table.toOriginal = toOriginal;
      table.fromOriginal = fromOriginal;
    }
    return { toOriginal: table.toOriginal, fromOriginal: table.fromOriginal };
  };

  /** Scheme verse → `original` verse. */
  const toCanonical = (verse: VerseId, scheme: Scheme): VerseId | undefined => {
    if (scheme === 'original') return verse;
    const source = sourceOf(verse, scheme) as SourceVerse;
    const { toOriginal, fromOriginal } = mappings(scheme);
    const mapped = toOriginal.get(sourceKey(source));
    if (mapped) return fromSourceVerse(mapped, 'original');
    // Same number, unless that original verse is mapped from another verse of the scheme.
    const claimed = fromOriginal.get(sourceKey(source));
    if (claimed && sourceKey(claimed) !== sourceKey(source)) return undefined;
    return fromSourceVerse(source, 'original');
  };

  /** `original` verse → scheme verse. */
  const fromCanonical = (verse: VerseId, scheme: Scheme): VerseId | undefined => {
    if (scheme === 'original') return verse;
    const original = sourceOf(verse, 'original') as SourceVerse;
    const { toOriginal, fromOriginal } = mappings(scheme);
    const mapped = fromOriginal.get(sourceKey(original));
    if (mapped) return fromSourceVerse(mapped, scheme);
    // Same number, unless the scheme maps that number somewhere else.
    const elsewhere = toOriginal.get(sourceKey(original));
    if (elsewhere && sourceKey(elsewhere) !== sourceKey(original)) return undefined;
    return fromSourceVerse(original, scheme);
  };

  const unknown = (where: string, scheme: Scheme): VersificationError =>
    new VersificationError('UNKNOWN_VERSE', `${where} does not exist in the ${scheme} scheme`);

  /** The error for a verse with no counterpart; Greek Esther's additions get their own code. */
  const noCounterpart = (canonical: VerseId | undefined, where: string, to: Scheme): VersificationError =>
    canonical && isLetteredChapter(canonical.book, canonical.c)
      ? new VersificationError(
          'UNSUPPORTED_GREEK_ESTHER',
          `${where}: the ${to} scheme has no verse numbers for the Greek additions to Esther; greekEstherLxx gives the Rahlfs verse`,
        )
      : new VersificationError('NO_COUNTERPART', `${where} has no counterpart in the ${to} scheme`);

  const tryMapVerse = (verse: VerseId, from: Scheme, to: Scheme): VerseId | undefined => {
    // Same scheme: no detour through `original`, where a many-to-one mapping could move the verse.
    if (from === to) return { book: verse.book, c: verse.c, v: verse.v };
    const canonical = toCanonical(verse, from);
    return canonical && fromCanonical(canonical, to);
  };

  const mapVerse = (verse: VerseId, from: Scheme, to: Scheme): VerseId => {
    definition(to);
    if (!verseExists(verse, from)) throw unknown(label(verse), from);
    const mapped = tryMapVerse(verse, from, to);
    if (!mapped) throw noCounterpart(toCanonical(verse, from), `${label(verse)} (${from})`, to);
    return mapped;
  };

  const pointExists = (book: BookCode, point: Point, scheme: Scheme): boolean =>
    point.v === undefined
      ? chapterLength(book, point.c, scheme) !== undefined
      : verseExists({ book, c: point.c, v: point.v }, scheme);

  const isRealVerse = (input: VerseInput, scheme: Scheme = 'original'): boolean => {
    definition(scheme);
    if (typeof input === 'object' && 'v' in input) return verseExists(input, scheme);
    let ref: Ref;
    try {
      ref = typeof input === 'string' ? fromKey(input) : input;
      checkRef(ref);
    } catch {
      return false; // fromKey and checkRef only throw RefError
    }
    return ref.segments.every(
      ({ start, end }) => pointExists(ref.book, start, scheme) && pointExists(ref.book, end, scheme),
    );
  };

  const mapRef = (ref: Ref, from: Scheme, to: Scheme): Ref => {
    checkRef(ref);
    definition(to);
    for (const { start, end } of ref.segments) {
      for (const point of [start, end]) {
        if (!pointExists(ref.book, point, from)) {
          throw unknown(pointLabel(ref.book, point), from);
        }
      }
    }
    const segments: Segment[] = [];
    for (const segment of ref.segments) {
      const verses = enumerateVerses({ book: ref.book, segments: [segment] }, (book, c) =>
        chapterLength(book, c, from),
      );
      const mapped = verses
        .filter((verse) => verseExists(verse, from))
        .map((verse) => tryMapVerse(verse, from, to))
        .filter((verse): verse is VerseId => verse !== undefined);
      segments.push(
        ...coalesce(
          ref.book,
          mapped,
          segment.start.v === undefined,
          (book, c) => chapterLength(book, c, to),
          (book, c) => firstVerse(book, c, to),
        ),
      );
    }
    if (segments.length === 0) {
      const first = (ref.segments[0] as Segment).start;
      throw noCounterpart(
        toCanonical(
          { book: ref.book, c: first.c, v: first.v ?? (firstVerse(ref.book, first.c, from) as number) },
          from,
        ),
        `${ref.book}: the reference (${from})`,
        to,
      );
    }
    return { book: ref.book, segments };
  };

  const notInOriginal = (verse: VerseId, scheme: Scheme = 'original'): boolean => {
    const canonical = mapVerse(verse, scheme, 'original');
    return GREEK_ADDITION_BOOKS.has((sourceOf(canonical, 'original') as SourceVerse).book);
  };

  const toSourceVerse = (verse: VerseId, scheme: Scheme = 'original'): SourceVerse => {
    if (!verseExists(verse, scheme)) throw unknown(label(verse), scheme);
    return sourceOf(verse, scheme) as SourceVerse;
  };

  return {
    chapterCount,
    chapterLength,
    firstVerse,
    verseCounts: (scheme = 'original') => {
      definition(scheme);
      return (book, c) => chapterLength(book, c, scheme);
    },
    isRealVerse,
    mapVerse,
    mapRef,
    notInOriginal,
    toSourceVerse,
    fromSourceVerse,
  };
}

/**
 * Joins verses that follow each other in the target scheme into segments
 * (across a chapter break too). With `wholeChapters`, a run covering whole
 * chapters is written as a chapter segment. `length` gives a chapter's last
 * verse and `first` its first (1 when omitted or unknown). Throws if a verse
 * leaves `book`.
 */
export function coalesce(
  book: BookCode,
  verses: readonly VerseId[],
  wholeChapters: boolean,
  length: VerseCountLookup,
  first: VerseCountLookup = () => 1,
): Segment[] {
  const start = (c: number): number => first(book, c) ?? 1;
  const runs: { start: VerseId; end: VerseId }[] = [];
  for (const verse of verses) {
    if (verse.book !== book) {
      throw new VersificationError('CROSSES_BOOKS', `${book}: ${label(verse)} falls in another book`);
    }
    const run = runs.at(-1);
    if (!run) {
      runs.push({ start: verse, end: verse });
      continue;
    }
    const { end } = run;
    if (end.c === verse.c && end.v === verse.v) continue;
    const next =
      (end.c === verse.c && end.v + 1 === verse.v) ||
      (end.c + 1 === verse.c && verse.v === start(verse.c) && end.v === length(book, end.c));
    if (next) run.end = verse;
    else runs.push({ start: verse, end: verse });
  }
  return runs.map((run) =>
    wholeChapters && run.start.v === start(run.start.c) && run.end.v === length(book, run.end.c)
      ? { start: { c: run.start.c }, end: { c: run.end.c } }
      : { start: { c: run.start.c, v: run.start.v }, end: { c: run.end.c, v: run.end.v } },
  );
}
