/**
 * Longest verbatim run: the longest stretch of consecutive words whose every
 * shingle is in the index. A run of `k` consecutive matching shingles covers
 * `k + n - 1` words, so a reported run is either 0 or at least `n` words.
 */
import { shingleKeys, wordHash } from './hash.ts';
import type { ShingleIndex } from './index-file.ts';
import { tokenise } from './normalise.ts';

/** The longest run in a text: its length in words and its UTF-16 offsets (`end` exclusive); all 0 when none. */
export interface Run {
  readonly words: number;
  readonly start: number;
  readonly end: number;
}

/** The longest run over word hashes: its length and first/last word positions (inclusive); all 0 when none. */
export interface WordRun {
  readonly words: number;
  readonly first: number;
  readonly last: number;
}

const NO_WORD_RUN: WordRun = { words: 0, first: 0, last: 0 };

/** Finds the longest run over consecutive shingle keys (entry `i` covers words `i … i + n - 1`). */
export function longestRunOfKeys(keys: readonly number[], index: ShingleIndex): WordRun {
  const n = index.shingleSize;
  let best = NO_WORD_RUN;
  let runStart = -1;
  for (let i = 0; i < keys.length; i++) {
    if (!index.has(keys[i] as number)) {
      runStart = -1;
      continue;
    }
    if (runStart < 0) runStart = i;
    const length = i - runStart + n;
    if (length > best.words) best = { words: length, first: runStart, last: i + n - 1 };
  }
  return best;
}

/** Finds the longest run in a sequence of word hashes (see {@link wordHash}). */
export function longestRunOfWordHashes(words: readonly bigint[], index: ShingleIndex): WordRun {
  return longestRunOfKeys(shingleKeys(words, index.shingleSize), index);
}

/** Finds the longest run of `text` that matches the index word for word (after normalisation). */
export function longestRun(text: string, index: ShingleIndex): Run {
  const tokens = tokenise(text);
  const best = longestRunOfWordHashes(
    tokens.map(({ word }) => wordHash(word)),
    index,
  );
  if (best.words === 0) return { words: 0, start: 0, end: 0 };
  return {
    words: best.words,
    start: (tokens[best.first] as (typeof tokens)[number]).start,
    end: (tokens[best.last] as (typeof tokens)[number]).end,
  };
}
