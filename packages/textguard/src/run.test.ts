import { describe, expect, it } from 'vitest';

import { wordHash } from './hash.ts';
import { buildIndex, loadIndex } from './index-file.ts';
import { tokenise } from './normalise.ts';
import { longestRun, longestRunOfKeys, longestRunOfWordHashes } from './run.ts';
import { shingleKeys } from './hash.ts';

// Invented source text (no Bible wording), standing in for an indexed edition.
const SOURCE =
  'At first light the old ferryman untied his boat, counted the lanterns twice, and pushed off toward the ' +
  'island where the orchard keepers waited for salt, rope and news from the mainland market.';
const index = loadIndex(buildIndex([SOURCE], { shingleSize: 8 }));

describe('longestRun', () => {
  it('finds a 15-word verbatim run and its offsets, whatever the case and punctuation', () => {
    const copied = 'ferryman UNTIED his boat — counted the lanterns twice and pushed off toward the island where';
    const text = `As the story goes, ${copied}; then he slept.`;
    const run = longestRun(text, index);
    expect(run.words).toBe(15);
    expect(text.slice(run.start, run.end)).toBe(copied);
  });

  it('reports the longest of several runs', () => {
    const text =
      'the old ferryman untied his boat counted the lanterns. Unrelated words here. ' +
      'pushed off toward the island where the orchard keepers waited for salt rope and news';
    const run = longestRun(text, index);
    expect(run.words).toBe(15);
    expect(text.slice(run.start, run.end)).toMatch(/^pushed off .* and news$/);
  });

  it('gives 0 for original prose, for runs shorter than a shingle and for short text', () => {
    expect(longestRun('A ferryman at dawn carries salt to the island orchards.', index)).toEqual({
      words: 0,
      start: 0,
      end: 0,
    });
    expect(longestRun('the old ferryman untied his boat counted', index).words).toBe(0);
    expect(longestRun('', index).words).toBe(0);
  });

  it('treats inline verse numbers as transparent', () => {
    const copied =
      'ferryman untied 12 his boat, counted ¹³ the lanterns twice and 14 pushed off toward the island where';
    const run = longestRun(`Quoted: ${copied}.`, index);
    expect(run.words).toBe(15);
    expect(`Quoted: ${copied}.`.slice(run.start, run.end)).toBe(copied);
  });

  it('counts exactly one shingle as n words', () => {
    expect(longestRun('the old ferryman untied his boat counted the', index).words).toBe(8);
  });
});

describe('longestRunOfKeys', () => {
  it('runs over shingle keys directly', () => {
    const keys = shingleKeys(
      tokenise(SOURCE).map((t) => wordHash(t.word)),
      8,
    );
    expect(longestRunOfKeys(keys, index).words).toBe(keys.length + 7);
    expect(longestRunOfKeys([keys[0]!, 1, keys[1]!, keys[2]!], index)).toEqual({ words: 9, first: 2, last: 10 });
    expect(longestRunOfKeys([], index).words).toBe(0);
  });
});

describe('longestRunOfWordHashes', () => {
  it('reports word positions', () => {
    const words = tokenise(`novel prefix ${SOURCE}`).map((t) => wordHash(t.word));
    expect(longestRunOfWordHashes(words, index)).toEqual({ words: words.length - 2, first: 2, last: words.length - 1 });
  });
});
