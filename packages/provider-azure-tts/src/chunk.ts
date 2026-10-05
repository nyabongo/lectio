/**
 * Splits narration text into pieces that each fit one Azure Speech request.
 *
 * Pieces break at sentence boundaries when possible, then at word boundaries, and only
 * as a last resort inside a word, so the synthesized audio joins at natural pauses.
 * Lengths are counted in Unicode code points, the unit Azure bills.
 */

/** Code-point length, so astral characters count once. */
export function codePointLength(text: string): number {
  return [...text].length;
}

function segments(text: string, granularity: 'sentence' | 'word'): string[] {
  return [...new Intl.Segmenter('en', { granularity }).segment(text)].map((part) => part.segment);
}

/** Splits a word that alone exceeds `max` into `max`-sized runs of code points. */
function hardSplit(word: string, max: number): string[] {
  const points = [...word];
  const out: string[] = [];
  for (let i = 0; i < points.length; i += max) out.push(points.slice(i, i + max).join(''));
  return out;
}

/** Greedily packs `parts` (in order) into strings of at most `max` code points. */
function pack(parts: readonly string[], max: number, split: (part: string) => string[]): string[] {
  const out: string[] = [];
  let current = '';
  for (const part of parts) {
    if (codePointLength(current) + codePointLength(part) <= max) {
      current += part;
      continue;
    }
    if (current !== '') out.push(current);
    if (codePointLength(part) <= max) {
      current = part;
      continue;
    }
    const pieces = split(part);
    // Every piece but the last is full; the last may still take following parts.
    // `split` of a non-empty part always returns at least one piece.
    current = pieces.pop() as string;
    out.push(...pieces);
  }
  if (current !== '') out.push(current);
  return out;
}

/**
 * Splits `text` into trimmed, non-empty chunks of at most `maxChars` code points each.
 * Whitespace-only text yields no chunks.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError(`maxChars must be a positive integer, got ${maxChars}`);
  }
  const bySentence = pack(segments(text, 'sentence'), maxChars, (sentence) =>
    pack(segments(sentence, 'word'), maxChars, (word) => hardSplit(word, maxChars)),
  );
  return bySentence.map((chunk) => chunk.trim()).filter((chunk) => chunk !== '');
}
