import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Token } from '@lectio/corpus';

import {
  EDITIONS,
  editionFor,
  editionVerse,
  isCorpusLanguage,
  languageName,
  lookupVerses,
  openEvidenceCorpus,
  phraseInTokens,
  phrasePieces,
  wordsNotInTokens,
} from './corpus.ts';

const CORPUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'corpus');

describe('editionFor', () => {
  it('picks SBLGNT or the Septuagint for Greek, OSHB for Hebrew and Aramaic, the Vulgate for Latin', () => {
    expect(editionFor('grc', 'MT')).toEqual({ edition: EDITIONS.greekNt });
    expect(editionFor('grc', 'GN')).toEqual({ edition: EDITIONS.greekOt });
    expect(editionFor('hbo', 'DT')).toEqual({ edition: EDITIONS.hebrew });
    expect(editionFor('arc', 'EZR')).toEqual({ edition: EDITIONS.hebrew });
    expect(editionFor('lat', 'MT')).toEqual({ edition: EDITIONS.latin });
  });

  it('has no Hebrew edition for books written in Greek', () => {
    expect(editionFor('hbo', 'WIS')).toEqual({ reason: 'Wisdom has no Hebrew or Aramaic original' });
    expect(editionFor('arc', 'MT')).toEqual({ reason: 'Matthew has no Hebrew or Aramaic original' });
  });
});

describe('editionVerse', () => {
  it('maps a canonical verse into the edition’s numbering', () => {
    expect(editionVerse({ book: 'MT', c: 20, v: 15 }, 'original')).toEqual({ c: 20, v: 15 });
    expect(editionVerse({ book: 'PS', c: 23, v: 1 }, 'vulgate')).toEqual({ c: 22, v: 1 });
    // OSHB numbers the Aramaic of Daniel 3 as the Masoretic text does.
    expect(editionVerse({ book: 'DN', c: 3, v: 91 }, 'original')).toEqual({ c: 3, v: 24 });
  });

  it('keeps the Lectio numbering when the .vrs file moves the verse to another book', () => {
    expect(editionVerse({ book: 'DN', c: 13, v: 1 }, 'lxx')).toEqual({ c: 13, v: 1 });
  });

  it('reads an unknown scheme name as original, and has no answer for a verse without a counterpart', () => {
    expect(editionVerse({ book: 'MT', c: 1, v: 1 }, 'NABRE')).toEqual({ c: 1, v: 1 });
    expect(editionVerse({ book: 'EX', c: 35, v: 8 }, 'lxx')).toBeUndefined();
  });
});

describe('openEvidenceCorpus', () => {
  const corpus = openEvidenceCorpus(CORPUS_ROOT);

  it('describes in-repo editions and reports missing ones', async () => {
    expect(await corpus.edition('grc-sblgnt')).toEqual({ language: 'grc', versification: 'original' });
    expect(await corpus.edition('lat-vulgate-clementine')).toEqual({ language: 'lat', versification: 'vulgate' });
    expect(await corpus.edition('grc-none')).toBeUndefined();
  });

  it('knows which books an edition has and reads verses', async () => {
    expect(await corpus.hasBook('hbo-oshb', 'DT')).toBe(true);
    expect(await corpus.hasBook('hbo-oshb', 'MT')).toBe(false);
    expect((await corpus.getVerse('grc-sblgnt', 'MT', 20, 15))?.length).toBeGreaterThan(5);
    expect(await corpus.getVerse('grc-sblgnt', 'MT', 20, 99)).toBeUndefined();
  });
});

describe('lookupVerses', () => {
  const corpus = openEvidenceCorpus(CORPUS_ROOT);

  it('collects the tokens of found verses and lists the missing ones', async () => {
    const lookup = await lookupVerses(corpus, 'grc', 'MT', [
      { book: 'MT', c: 6, v: 22 },
      { book: 'MT', c: 6, v: 23 },
    ]);
    expect(lookup).toMatchObject({ kind: 'ok', edition: 'grc-sblgnt', language: 'grc', missing: [] });
    // SBLGNT omits Mt 17:21 (a later addition), and the Septuagint scheme has no Exodus 35:8.
    const lost = await lookupVerses(corpus, 'grc', 'MT', [{ book: 'MT', c: 17, v: 21 }]);
    expect(lost).toMatchObject({ kind: 'ok', tokens: [], missing: [{ book: 'MT', c: 17, v: 21 }] });
    const lxx = {
      ...corpus,
      edition: () => Promise.resolve({ language: 'grc' as const, versification: 'lxx' }),
      hasBook: () => Promise.resolve(true),
    };
    expect(await lookupVerses(lxx, 'grc', 'EX', [{ book: 'EX', c: 35, v: 8 }])).toMatchObject({
      missing: [{ book: 'EX', c: 35, v: 8 }],
    });
  });
});

describe('phrase matching', () => {
  const greek: Token[] = [
    ['ὁ', 'ὁ'],
    ['ὀφθαλμός', 'ὀφθαλμός'],
    ['σου', 'σύ'],
    ['πονηρός', 'πονηρός'],
    ['ἐστιν', 'εἰμί'],
  ];

  it('splits text into word runs at ellipses', () => {
    expect(phrasePieces('grc', 'ὀφθαλμός σου … ἐστιν...')).toEqual([['οφθαλμοσ', 'σου'], ['εστιν']]);
  });

  it('matches consecutive words by surface or lemma, pieces in order', () => {
    expect(phraseInTokens('grc', greek, 'ὀφθαλμὸς σου πονηρὸς')).toBe(true);
    expect(phraseInTokens('grc', greek, 'σύ πονηρός εἰμί')).toBe(true);
    expect(phraseInTokens('grc', greek, 'ὀφθαλμός πονηρός')).toBe(false);
    expect(phraseInTokens('grc', greek, 'ὁ … ἐστιν')).toBe(true);
    expect(phraseInTokens('grc', greek, 'ἐστιν … ὁ')).toBe(false);
    expect(phraseInTokens('grc', greek, '…')).toBe(false);
  });

  it('matches Hebrew by stem, with or without prefixes', () => {
    const hebrew: Token[] = [
      ['וְ/רָעָ֣ה', 'c/7489 a', 'HC/Vqq3fs'],
      ['עֵֽינְ/ךָ֗', '5869 a', 'HNcbsc/Sp2ms'],
    ];
    expect(phraseInTokens('hbo', hebrew, 'וְרָעָה עֵינְךָ')).toBe(true);
    expect(phraseInTokens('hbo', hebrew, 'רָעָה עַיִן')).toBe(true);
    expect(phraseInTokens('hbo', hebrew, 'רָעָה לֵב')).toBe(false);
    expect(phraseInTokens('hbo', hebrew, 'ו')).toBe(false);
    expect(wordsNotInTokens('hbo', hebrew, 'עין רעה')).toEqual([]);
  });

  it('lists the words that occur nowhere in the tokens, as written', () => {
    expect(wordsNotInTokens('grc', greek, 'ὀφθαλμός, πονειρός … ἀγαθός')).toEqual(['πονειρός', 'ἀγαθός']);
    expect(wordsNotInTokens('grc', greek, 'πονηρός ὀφθαλμός')).toEqual([]);
  });
});

describe('languages', () => {
  it('recognises the corpus languages and names them', () => {
    expect(['grc', 'hbo', 'arc', 'lat', 'en', undefined].map(isCorpusLanguage)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(languageName('arc')).toBe('Aramaic');
  });
});
