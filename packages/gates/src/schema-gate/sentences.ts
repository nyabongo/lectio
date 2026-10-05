/**
 * Splitting cited prose into sentences and their claim markers.
 *
 * A context paragraph or note body is runs of prose, each followed by markers
 * (`Only Matthew tells this parable. [c1] He places it after Peter’s question. [c2]`). Segmenting
 * the whole string does not work: ICU keeps `parable. [c1] He` together, because a lower-case
 * letter (`c`) follows the full stop. So the text is cut at the markers first, and each prose run
 * is segmented on its own with `Intl.Segmenter`; the markers after a run belong to its last
 * sentence, and any earlier sentence in the run has none.
 */
import { BOOKS } from '@lectio/refs';

/** One sentence and the claim ids of the markers that follow it (empty when none do). */
export interface CitedSentence {
  readonly text: string;
  readonly claimIds: readonly string[];
}

const MARKER_RUN = /((?:\[c[1-9][0-9]*\])+)/;
const MARKER = /\[(c[1-9][0-9]*)\]/g;

/** How claim markers are written, for messages. */
export const MARKER_FORMAT = 'markers look like [c1] or [c2][c3] and follow the closing punctuation';

/** The claim ids in a run of markers: `[c2][c3]` → `['c2', 'c3']`. */
export function markerIds(run: string): string[] {
  return [...run.matchAll(MARKER)].map((match) => match[1] as string);
}

/** Bracketed text that is not a claim marker: `[C1]`, `[c01]`, `[c1, c2]`. */
export function malformedMarkers(text: string): string[] {
  return [...text.matchAll(/\[[^\]]*\]?/g)]
    .map((match) => match[0])
    .filter((group) => !/^\[c[1-9][0-9]*\]$/.test(group));
}

/**
 * Abbreviations that end in a full stop without ending a sentence. V8's `Intl.Segmenter` ignores
 * ICU's abbreviation list, so `St. Paul`, `(cf. Mt 18:21)` and `c. 30 A.D.` would otherwise be
 * split. `etc.` is left out: it often does end a sentence.
 */
const FIXED_ABBREVIATIONS = [
  'St',
  'Sts',
  'Dr',
  'Mr',
  'Mrs',
  'Fr',
  'Sr',
  'Br',
  'Bl',
  'Card',
  'Abp',
  'Bp',
  'Msgr',
  'Rev',
  'cf',
  'Cf',
  'c',
  'ca',
  'ch',
  'chs',
  'v',
  'vv',
  'e.g',
  'i.e',
  'viz',
  'lit',
  'vol',
  'vols',
  'p',
  'pp',
  'n',
  'nn',
  'no',
  'nos',
  'ed',
  'eds',
  'trans',
  'A.D',
  'B.C',
  'B.C.E',
  'C.E',
  'a.m',
  'p.m',
];

/**
 * Book abbreviations from `@lectio/refs` (`Gn`, `Deut`, `Cor`, `Prv`, …) without their ordinal.
 * Only short forms count: a word of the book's name (`Job`, `Acts`, `Ruth`), a longer spelling
 * (`Canticles`, `Apocalypse`) or an ordinary word (`Song`, `Psalm`) can end a sentence.
 */
const NOT_ABBREVIATIONS: ReadonlySet<string> = new Set(['song', 'psalm']);

function bookAbbreviations(): string[] {
  return BOOKS.flatMap((book) => {
    const words = new Set(book.name.toLowerCase().split(' '));
    return [book.abbrev, book.osis, ...book.aliases]
      .map((spelling) => (spelling.split(' ').at(-1) as string).replace(/^[0-9]+/, ''))
      .filter(
        (token) =>
          /^[A-Za-z]{1,5}$/.test(token) &&
          !words.has(token.toLowerCase()) &&
          !NOT_ABBREVIATIONS.has(token.toLowerCase()),
      );
  });
}

export const ABBREVIATIONS: ReadonlySet<string> = new Set([...FIXED_ABBREVIATIONS, ...bookAbbreviations()]);

/** True when `segment` ends in a known abbreviation or an initial (`W.`), so the sentence goes on. */
export function endsInAbbreviation(segment: string): boolean {
  const word = (segment.split(/\s+/).at(-1) as string).replace(/^[("“‘'[]+/, '');
  if (!word.endsWith('.')) return false;
  const stem = word.slice(0, -1);
  return ABBREVIATIONS.has(stem) || /^\p{Lu}$/u.test(stem);
}

/** The sentences of one prose run: segmented, then rejoined after abbreviations and initials. */
function sentencesOf(segmenter: Intl.Segmenter, prose: string): string[] {
  const merged: string[] = [];
  let pending = '';
  for (const { segment } of segmenter.segment(prose)) {
    pending += segment;
    if (!endsInAbbreviation(pending.trimEnd())) {
      merged.push(pending);
      pending = '';
    }
  }
  merged.push(pending);
  return merged.map((sentence) => sentence.trim()).filter((sentence) => sentence !== '');
}

const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Every sentence of `text`, in order, with the markers that cite it. A run with no letters or
 * digits (the `.` in `a day’s wage [c9]. Next…`) is not a sentence: it joins the sentence before
 * it, together with any markers that follow it.
 */
export function citedSentences(text: string, locale: string): CitedSentence[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const parts = text.split(MARKER_RUN);
  const sentences: { text: string; claimIds: string[] }[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const prose = sentencesOf(segmenter, parts[index] as string);
    const claimIds = markerIds(parts[index + 1] ?? '');
    prose.forEach((sentence, position) => {
      const ids = position === prose.length - 1 ? claimIds : [];
      const previous = sentences.at(-1);
      if (!HAS_WORD.test(sentence) && previous !== undefined) {
        previous.text += sentence;
        previous.claimIds.push(...ids);
      } else {
        sentences.push({ text: sentence, claimIds: [...ids] });
      }
    });
  }
  return sentences;
}

/** A short excerpt for messages: the first `max` characters of `text`, with an ellipsis when cut. */
export function excerpt(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
