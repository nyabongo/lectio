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
 * - An excerpt found anywhere else (a section that is not a public-domain work, or a page without
 *   known headings) keeps only the sentences or clauses it spans.
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
  /** Excerpts on the page that span more than {@link MAX_EXCERPT_LINES} lines outside a kept section. */
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

/** Sentence and clause ends: the points a line-kept excerpt is trimmed at. */
const CLAUSE_END = /(?<=[.;:!?,])\s+|\n/u;

/** The fewest consecutive sentences or clauses of `text` that hold `excerpt` (which must occur in it). */
export function clausesHolding(text: string, excerpt: string): string {
  const clauses = text.split(CLAUSE_END);
  for (let size = 1; size < clauses.length; size++) {
    for (let start = 0; start + size <= clauses.length; start++) {
      const run = clauses.slice(start, start + size).join(' ');
      if (excerptOccurs(excerpt, run)) return run;
    }
  }
  return clauses.join(' ');
}

/** Reduces a fetched page to what the fixture may hold (see the module comment). */
export function reducePage(url: string, text: string, excerpts: readonly string[]): ReducedPage {
  const missing = excerpts.filter((excerpt) => !excerptOccurs(excerpt, text));
  if (WHOLE_PAGE_HOSTS.has(new URL(url).host)) return { text, missing, unplaced: [], sections: [] };
  const lines = text.split('\n');
  const sections = sectionsOf(lines);
  /** What is kept, by first line: whole section lines, or trimmed clauses. */
  const blocks = new Map<number, string>();
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
      for (let index = section.start; index < section.end; index++) keep.add(index);
      continue;
    }
    const range = linesHolding(lines, excerpt);
    if (range === undefined) {
      unplaced.push(excerpt);
      continue;
    }
    const clauses = clausesHolding(joined(lines, range.start, range.end), excerpt);
    const before = blocks.get(range.start);
    if (before === undefined) blocks.set(range.start, clauses);
    else if (!before.includes(clauses)) blocks.set(range.start, `${before}\n${clauses}`);
  }
  // Whole sections win over clauses trimmed from the same lines.
  const out: string[] = [];
  lines.forEach((line, index) => {
    const block = keep.has(index) ? line : blocks.get(index);
    if (block === undefined) return;
    if (out.length > 0 && !(keep.has(index) && keep.has(index - 1))) out.push('');
    out.push(block);
  });
  return { text: out.length === 0 ? '' : `${out.join('\n')}\n`, missing, unplaced, sections: kept };
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
