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

/** One sentence and the claim ids of the markers that follow it (empty when none do). */
export interface CitedSentence {
  readonly text: string;
  readonly claimIds: readonly string[];
}

const MARKER_RUN = /((?:\[c[1-9][0-9]*\])+)/;
const MARKER = /\[(c[1-9][0-9]*)\]/g;

/** The claim ids in a run of markers: `[c2][c3]` → `['c2', 'c3']`. */
export function markerIds(run: string): string[] {
  return [...run.matchAll(MARKER)].map((match) => match[1] as string);
}

/** Every sentence of `text`, in order, with the markers that cite it. */
export function citedSentences(text: string, locale: string): CitedSentence[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' });
  const parts = text.split(MARKER_RUN);
  const sentences: CitedSentence[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const prose = [...segmenter.segment(parts[index] as string)]
      .map(({ segment }) => segment.trim())
      .filter((segment) => segment !== '');
    const claimIds = markerIds(parts[index + 1] ?? '');
    prose.forEach((sentence, position) => {
      sentences.push({ text: sentence, claimIds: position === prose.length - 1 ? claimIds : [] });
    });
  }
  return sentences;
}

/** A short excerpt for messages: the first `max` characters of `text`, with an ellipsis when cut. */
export function excerpt(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
