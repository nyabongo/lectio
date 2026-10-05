/**
 * Recorded source pages for the seed-week integration suite (L-033).
 *
 * `tests/gates/fixtures/seed-pages/` holds, for every web source the committed passages cite, the
 * text the live fetcher (`@lectio/provider-fetch`) returned when the pages were recorded, reduced
 * so the repository never stores a translation's reading text or a copyrighted work:
 *
 * - A page split into sections by a known heading (Bible Hub commentary and lexicon pages) keeps,
 *   in full, each section of a public-domain work that holds a cited excerpt (`PD_SECTIONS`). The
 *   page header (the verse in an English translation) and every other section are dropped.
 * - Inside a kept section, verse text is dropped (ADR 0003: no reading text, not even public-domain,
 *   not in fixtures): a bare verse reference line (`Luke 9:62`, as chapter pages print before each
 *   verse) with the verse on the line after it, and a numbered verse line (`1 Blessed are …`) with
 *   its stichs. `verseTextLines` finds them; guard tests in seed-week.test.ts fail if a recorded
 *   page still holds one, or a line that is mostly public-domain Bible wording.
 * - An excerpt found anywhere else (a section that is not a public-domain work, or a page without
 *   known headings) keeps only the excerpt itself, as the passage quotes it.
 * - Pages of public-domain reference works (`WHOLE_PAGE_HOSTS`) are kept whole.
 *
 * So `evidence/web-excerpt-found` sees every cited excerpt in the text the live page held, and
 * `licence/commentary-overlap` compares the notes with the full cited commentary sections. A note
 * that copied wording from an uncited section of a cited page would be caught only by the live run
 * in content-gates.yml, not here.
 *
 * `record-seed-pages.ts` (next to this file) refreshes the fixtures from the live pages.
 */
import { excerptOccurs } from '../../../packages/gates/src/evidence-gate/normalise.ts';

/** Section headings of public-domain works on Bible Hub pages; such a section is kept whole when cited. */
export const PD_SECTIONS: ReadonlySet<string> = new Set([
  "Barnes' Notes on the Bible",
  'Benson Commentary',
  "Bengel's Gnomen",
  'Brown-Driver-Briggs',
  'Cambridge Bible for Schools and Colleges',
  "Ellicott's Commentary for English Readers",
  "Expositor's Greek Testament",
  'Geneva Study Bible',
  "Gill's Exposition of the Entire Bible",
  'Jamieson-Fausset-Brown Bible Commentary',
  'Keil and Delitzsch Biblical Commentary on the Old Testament',
  "MacLaren's Expositions",
  "Matthew Henry's Concise Commentary",
  "Matthew Poole's Commentary",
  "Meyer's NT Commentary",
  'Pulpit Commentary',
  "Strong's Exhaustive Concordance",
  "Thayer's Greek Lexicon",
  'The Treasury of David',
  "Vincent's Word Studies",
]);

/** Other section headings: they end a section, and their sections are never kept whole. */
export const OTHER_SECTIONS: ReadonlySet<string> = new Set([
  'EXEGETICAL (ORIGINAL LANGUAGES)',
  'EXPOSITORY (ENGLISH BIBLE)',
  "Englishman's Concordance",
  'Forms and Transliterations',
  'HELPS Word-studies',
  'Lexical Summary',
  'Links',
  'NAS Exhaustive Concordance',
  'Topical Lexicon',
]);

/** Hosts of public-domain reference works (Jewish Encyclopedia 1906, Catholic Encyclopedia 1907): kept whole. */
export const WHOLE_PAGE_HOSTS: ReadonlySet<string> = new Set(['www.jewishencyclopedia.com', 'www.newadvent.org']);

/** At most this many consecutive lines are kept for an excerpt found outside a public-domain section. */
export const MAX_EXCERPT_LINES = 4;

export interface ReducedPage {
  /** The text to record. */
  readonly text: string;
  /** Excerpts not on the page at all: the evidence gate will report each one. */
  readonly missing: readonly string[];
  /**
   * Excerpts on the page that span more than {@link MAX_EXCERPT_LINES} lines outside a kept section
   * (or, inside one, run across dropped verse text).
   */
  readonly unplaced: readonly string[];
  /** Headings of the sections kept whole. */
  readonly sections: readonly string[];
}

interface Range {
  readonly start: number;
  readonly end: number;
  readonly heading: string | undefined;
}

/** The page's sections: the header (no heading) then one range per heading line. */
function sectionsOf(lines: readonly string[]): Range[] {
  const ranges: Range[] = [];
  let start = 0;
  let heading: string | undefined;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!PD_SECTIONS.has(trimmed) && !OTHER_SECTIONS.has(trimmed)) return;
    ranges.push({ start, end: index, heading });
    start = index;
    heading = trimmed;
  });
  ranges.push({ start, end: lines.length, heading });
  return ranges;
}

const joined = (lines: readonly string[], start: number, end: number): string => lines.slice(start, end).join('\n');

/** The fewest consecutive lines (up to {@link MAX_EXCERPT_LINES}) that hold `excerpt`. */
function linesHolding(lines: readonly string[], excerpt: string): Range | undefined {
  for (let size = 1; size <= MAX_EXCERPT_LINES; size++) {
    for (let start = 0; start + size <= lines.length; start++) {
      if (excerptOccurs(excerpt, joined(lines, start, start + size)))
        return { start, end: start + size, heading: undefined };
    }
  }
  return undefined;
}

/** A line that is only a verse reference (`Luke 9:62`, `Psalm 90:7`, `1 Corinthians 2:13`). */
export const VERSE_REFERENCE_LINE = /^(?:[1-3] )?[A-Z][a-z]+(?: of [A-Z][a-z]+)? \d+:\d+$/u;

/**
 * A line that starts with a verse number and reads as verse text: a capital after the number, no
 * other digit, and at most {@link MAX_VERSE_WORDS} words (`1 Blessed are the undefiled in the way, …`,
 * the strophes the Treasury of David and Keil–Delitzsch print before their comment).
 */
export const NUMBERED_VERSE_LINE = /^\d{1,3} [A-Z][^0-9]*$/u;

/** Verse lines and the stichs after them are at most this many words. */
export const MAX_VERSE_WORDS = 25;
/** A line after a numbered verse line with at most this many words (and no digit) is a further stich. */
export const MAX_STICH_WORDS = 15;

const isHeading = (line: string): boolean => PD_SECTIONS.has(line.trim()) || OTHER_SECTIONS.has(line.trim());
const wordsIn = (line: string): number => line.trim().split(/\s+/u).length;
const isNumberedVerse = (line: string): boolean =>
  NUMBERED_VERSE_LINE.test(line.trim()) && wordsIn(line) <= MAX_VERSE_WORDS;
const isStich = (line: string): boolean =>
  !isHeading(line) && !/\d/u.test(line) && wordsIn(line) <= MAX_STICH_WORDS && !isNumberedVerse(line);

/**
 * Indexes of the lines that hold verse text, and the reference lines before them:
 *
 * - a bare reference line, and the next line when it is text (not blank, not a section heading);
 * - a numbered verse line, and the short stichs that follow it (blank lines between them allowed),
 *   up to the first longer line, heading or digit.
 */
export function verseTextLines(lines: readonly string[]): Set<number> {
  const found = new Set<number>();
  lines.forEach((line, index) => {
    if (VERSE_REFERENCE_LINE.test(line.trim())) {
      found.add(index);
      const next = lines[index + 1];
      if (next !== undefined && next.trim() !== '' && !isHeading(next)) found.add(index + 1);
      return;
    }
    if (!isNumberedVerse(line)) return;
    found.add(index);
    for (let after = index + 1; after < lines.length; after++) {
      const next = lines[after] as string;
      if (next.trim() === '') continue;
      if (!isStich(next)) break;
      found.add(after);
    }
  });
  return found;
}

/** Reduces a fetched page to what the fixture may hold (see the module comment). */
export function reducePage(url: string, text: string, excerpts: readonly string[]): ReducedPage {
  const missing = excerpts.filter((excerpt) => !excerptOccurs(excerpt, text));
  if (WHOLE_PAGE_HOSTS.has(new URL(url).host)) return { text, missing, unplaced: [], sections: [] };
  const lines = text.split('\n');
  const sections = sectionsOf(lines);
  const verses = verseTextLines(lines);
  /** Excerpts kept on their own, by the first line they occur on. */
  const quoted = new Map<number, string[]>();
  const keep = new Set<number>();
  const kept: string[] = [];
  const unplaced: string[] = [];
  for (const excerpt of excerpts) {
    if (missing.includes(excerpt)) continue;
    const section = sections.find(
      (range) =>
        range.heading !== undefined &&
        PD_SECTIONS.has(range.heading) &&
        excerptOccurs(excerpt, joined(lines, range.start, range.end)),
    );
    if (section !== undefined) {
      if (!kept.includes(section.heading as string)) kept.push(section.heading as string);
      for (let index = section.start; index < section.end; index++) if (!verses.has(index)) keep.add(index);
      continue;
    }
    const range = linesHolding(lines, excerpt);
    if (range === undefined) {
      unplaced.push(excerpt);
      continue;
    }
    quoted.set(range.start, [...(quoted.get(range.start) ?? []), excerpt]);
  }
  // An excerpt that quotes dropped verse text is kept on its own, as the passage quotes it.
  const keptText = lines.filter((_, index) => keep.has(index)).join('\n');
  for (const excerpt of excerpts) {
    if (missing.includes(excerpt) || unplaced.includes(excerpt) || [...quoted.values()].flat().includes(excerpt))
      continue;
    if (excerptOccurs(excerpt, keptText)) continue;
    const range = linesHolding(lines, excerpt);
    if (range !== undefined) quoted.set(range.start, [...(quoted.get(range.start) ?? []), excerpt]);
  }
  const out: string[] = [];
  lines.forEach((line, index) => {
    const block = keep.has(index) ? line : quoted.get(index)?.join('\n');
    if (block === undefined) return;
    if (out.length > 0 && !(keep.has(index) && keep.has(index - 1))) out.push('');
    out.push(block);
  });
  // Anything still not in the reduced text is reported, so the recorder flags it.
  // Blank lines left where verse text was dropped collapse to one.
  const reduced = out.length === 0 ? '' : `${out.join('\n').replace(/\n{3,}/gu, '\n\n')}\n`;
  for (const excerpt of excerpts) {
    if (!missing.includes(excerpt) && !unplaced.includes(excerpt) && !excerptOccurs(excerpt, reduced))
      unplaced.push(excerpt);
  }
  return { text: reduced, missing, unplaced, sections: kept };
}

/** A fixture file name for `url`: host and path, with every other character replaced. */
export function fixtureName(url: string): string {
  const { host, pathname } = new URL(url);
  const path = pathname
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\.html?$/u, '')
    .replace(/[^A-Za-z0-9.-]+/gu, '_');
  return `${host}_${path}.txt`;
}
