import { describe, expect, it } from 'vitest';

import { citedSentences, excerpt, markerIds } from './sentences.ts';

describe('citedSentences', () => {
  it('gives each sentence the markers that follow it', () => {
    expect(
      citedSentences('Only Matthew tells this parable. [c1] He places it after a question. [c2][c3]', 'en'),
    ).toEqual([
      { text: 'Only Matthew tells this parable.', claimIds: ['c1'] },
      { text: 'He places it after a question.', claimIds: ['c2', 'c3'] },
    ]);
  });

  it('leaves earlier sentences of a run, and trailing prose, without markers', () => {
    expect(citedSentences('One sentence. Another one. [c1] A trailing one.', 'en')).toEqual([
      { text: 'One sentence.', claimIds: [] },
      { text: 'Another one.', claimIds: ['c1'] },
      { text: 'A trailing one.', claimIds: [] },
    ]);
  });

  it('does not split at a full stop inside a reference or before a lower-case word', () => {
    expect(citedSentences('As in Deut 15:9 and Prov 28:22, e.g. here. [c1]', 'en')).toEqual([
      { text: 'As in Deut 15:9 and Prov 28:22, e.g. here.', claimIds: ['c1'] },
    ]);
  });

  it('returns nothing for markers alone or empty text', () => {
    expect(citedSentences('', 'en')).toEqual([]);
    expect(citedSentences('[c1]', 'en')).toEqual([]);
  });
});

describe('markerIds', () => {
  it('lists the claim ids of a marker run', () => {
    expect(markerIds('[c2][c10]')).toEqual(['c2', 'c10']);
    expect(markerIds('no markers')).toEqual([]);
  });
});

describe('excerpt', () => {
  it('keeps short text and cuts long text with an ellipsis', () => {
    expect(excerpt('short')).toBe('short');
    expect(excerpt('a'.repeat(70))).toBe(`${'a'.repeat(59)}…`);
    expect(excerpt('word '.repeat(20), 12)).toBe('word word w…');
  });
});
