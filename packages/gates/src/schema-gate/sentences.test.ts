import { describe, expect, it } from 'vitest';

import {
  ABBREVIATIONS,
  citedSentences,
  endsInAbbreviation,
  excerpt,
  malformedMarkers,
  markerIds,
} from './sentences.ts';

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

  it.each([
    ['St. Paul writes this to the Romans. [c1]'],
    ['As St. Augustine notes, the hour matters. [c1]'],
    ['The word is plural (cf. Mt 18:21). [c1]'],
    ['Dr. Smith argues this. [c1]'],
    ['The parable dates to c. 30 A.D. in Galilee. [c1]'],
    ['W. D. Davies and Dale C. Allison agree. [c1]'],
    ['The image recurs in Deut. 15:9 and Prov. 28:22, i.e. twice. [c1]'],
  ])('keeps an abbreviation or initial inside its sentence: %s', (text) => {
    expect(citedSentences(text, 'en')).toEqual([{ text: text.replace(' [c1]', ''), claimIds: ['c1'] }]);
  });

  it('still ends a sentence at a book name or a lower-case word', () => {
    expect(citedSentences('The book is Job. Then comes another. [c1]', 'en').map((s) => s.text)).toEqual([
      'The book is Job.',
      'Then comes another.',
    ]);
  });

  it('joins a punctuation-only run, and its markers, to the sentence before', () => {
    expect(citedSentences('A day’s wage [c9]. Next one. [c2]', 'en')).toEqual([
      { text: 'A day’s wage.', claimIds: ['c9'] },
      { text: 'Next one.', claimIds: ['c2'] },
    ]);
    expect(citedSentences('A day’s wage [c9]. [c3]', 'en')).toEqual([
      { text: 'A day’s wage.', claimIds: ['c9', 'c3'] },
    ]);
    expect(citedSentences('. Then. [c1]', 'en').map((s) => s.text)).toEqual(['.', 'Then.']);
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

describe('malformedMarkers', () => {
  it('lists bracketed text that is not a claim marker', () => {
    expect(malformedMarkers('a [c1] b [C1] c [c01] d [c1, c2] e [c2')).toEqual(['[C1]', '[c01]', '[c1, c2]', '[c2']);
  });
});

describe('endsInAbbreviation', () => {
  it('recognises fixed and book abbreviations and initials, with leading punctuation', () => {
    for (const text of ['St.', '(cf.', 'e.g.', 'A.D.', 'Gn.', 'Cor.', 'W.', '“Mt.']) {
      expect(endsInAbbreviation(`see ${text}`)).toBe(true);
    }
    for (const text of ['Job.', 'Acts.', 'Song.', 'Canticles.', 'Paul.', 'etc.', 'St', 'word.'])
      expect(endsInAbbreviation(`see ${text}`)).toBe(false);
    expect(ABBREVIATIONS.has('Deut')).toBe(true);
  });
});

describe('excerpt', () => {
  it('keeps short text and cuts long text with an ellipsis', () => {
    expect(excerpt('short')).toBe('short');
    expect(excerpt('a'.repeat(70))).toBe(`${'a'.repeat(59)}…`);
    expect(excerpt('word '.repeat(20), 12)).toBe('word word w…');
  });
});
