import { fileURLToPath } from 'node:url';

import { openCorpus } from '@lectio/corpus';
import type { Corpus, SourceInfo, Token } from '@lectio/corpus';
import { getBook } from '@lectio/refs';
import { describe, expect, it } from 'vitest';

import {
  GREEK_NT,
  HEBREW_OT,
  LATIN_VULGATE,
  defaultEditions,
  formatOriginalText,
  loadOriginalText,
} from './original.ts';

/** The repository corpus (openly licensed original-language editions). */
const CORPUS = openCorpus(fileURLToPath(new URL('../../../../corpus', import.meta.url)));

function info(name: string, language: SourceInfo['language']): SourceInfo {
  return {
    name,
    language,
    upstreamUrl: 'https://example.org/x.tar.gz',
    version: '1',
    sha256: '0'.repeat(64),
    licence: 'CC0-1.0',
    attribution: 'x',
    versification: 'original',
  };
}

/** A corpus whose `verses` map `edition BOOK c:v` to tokens. */
function fakeCorpus(verses: Record<string, readonly Token[]>): Corpus & { calls: string[] } {
  const calls: string[] = [];
  return {
    root: '/fake',
    calls,
    editions: async () => ['a'],
    source: async (edition) => info(`Edition ${edition}`, edition.startsWith('lat') ? 'lat' : 'hbo'),
    getVerse: async (edition, book, c, v) => {
      const id = `${edition} ${book} ${String(c)}:${String(v)}`;
      calls.push(id);
      return verses[id] === undefined ? undefined : [...verses[id]];
    },
    findWord: async () => ({ verseFound: false, matches: [] }),
    phraseOccurs: async () => false,
  };
}

describe('defaultEditions', () => {
  it('uses Greek for the New Testament', () => {
    expect(defaultEditions(getBook('MT'))).toEqual([GREEK_NT]);
  });

  it('uses Hebrew, then the Vulgate, for the Hebrew Old Testament', () => {
    expect(defaultEditions(getBook('IS'))).toEqual([HEBREW_OT, LATIN_VULGATE]);
  });

  it('uses the Vulgate for books without a Hebrew original', () => {
    expect(defaultEditions(getBook('WIS'))).toEqual([LATIN_VULGATE]);
  });
});

describe('loadOriginalText', () => {
  it('reads Mt 20:1-16 from the Greek corpus', async () => {
    const original = await loadOriginalText(CORPUS, 'MT.20.1-16');
    expect(original.verses).toHaveLength(16);
    expect(original.missing).toEqual([]);
    expect(original.editions).toEqual([
      expect.objectContaining({ edition: 'grc-sblgnt', language: 'grc', licence: expect.stringContaining('CC-BY') }),
    ]);
    const v15 = original.verses.find((v) => v.verse === '20:15');
    expect(v15?.text).toContain('ὀφθαλμός σου πονηρός');
    expect(v15?.text).toContain('ἀγαθός');
  });

  it('falls back to the next edition and maps verse numbers into its scheme', async () => {
    const corpus = fakeCorpus({
      'hbo-oshb IS 55:6': [['דִּרְשׁוּ', 'דרשׁ']],
      'lat-vulgate-clementine IS 55:7': [
        ['derelinquat', 'derelinquo'],
        ['impius', 'impius'],
      ],
    });
    const original = await loadOriginalText(corpus, 'IS.55.6-8');
    expect(original.verses).toEqual([
      { verse: '55:6', edition: 'hbo-oshb', language: 'hbo', text: 'דִּרְשׁוּ' },
      { verse: '55:7', edition: 'lat-vulgate-clementine', language: 'lat', text: 'derelinquat impius' },
    ]);
    expect(original.missing).toEqual(['55:8']);
    expect(original.editions.map((e) => e.edition)).toEqual(['hbo-oshb', 'lat-vulgate-clementine']);
  });

  it('skips an edition whose scheme has no counterpart for the verse', async () => {
    const corpus = fakeCorpus({});
    const original = await loadOriginalText(corpus, 'MT.20.1', {
      editionsFor: () => [{ edition: 'lat-x', scheme: 'no-such-scheme' as never }, GREEK_NT],
    });
    expect(corpus.calls).toEqual(['grc-sblgnt MT 20:1']);
    expect(original).toEqual({ verses: [], editions: [], missing: ['20:1'] });
  });

  it('treats an empty verse as missing', async () => {
    const original = await loadOriginalText(fakeCorpus({ 'grc-sblgnt MT 20:1': [] }), 'MT.20.1');
    expect(original.missing).toEqual(['20:1']);
  });
});

describe('formatOriginalText', () => {
  it('lists the editions, the verses and what is missing', () => {
    const text = formatOriginalText({
      editions: [{ edition: 'grc-sblgnt', name: 'SBLGNT', language: 'grc', licence: 'CC-BY-4.0' }],
      verses: [{ verse: '20:15', edition: 'grc-sblgnt', language: 'grc', text: 'ἀγαθός' }],
      missing: ['20:16'],
    });
    expect(text).toBe(
      'Edition `grc-sblgnt`: SBLGNT (grc, CC-BY-4.0).\n\n- 20:15 (grc-sblgnt): ἀγαθός\n\n' +
        'The corpus has no original-language text for: 20:16.',
    );
  });

  it('says so when nothing is in the corpus', () => {
    expect(formatOriginalText({ editions: [], verses: [], missing: ['1:1'] })).toBe(
      'The corpus has no original-language text for: 1:1.',
    );
  });

  it('prints only verses when nothing is missing', () => {
    const text = formatOriginalText({
      editions: [],
      verses: [{ verse: '1:1', edition: 'e', language: 'grc', text: 't' }],
      missing: [],
    });
    expect(text).toBe('- 1:1 (e): t');
  });
});
