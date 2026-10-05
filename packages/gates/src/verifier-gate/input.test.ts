import { describe, expect, it } from 'vitest';

import { MemorySourceFetcher } from '@lectio/providers';
import type { SourceFetcher } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { SEED } from './fixtures/context.ts';
import { MAX_FETCHED_CHARS, claimInput, fetchSourceTexts, trimFetched } from './input.ts';

const passage = (sources: Passage['sources'], sourceIds: string[]): Passage =>
  ({ ...SEED, claims: [{ id: 'c1', text: 'A claim.', sourceIds, sensitive: true }], sources }) as Passage;

describe('trimFetched', () => {
  it('keeps short text whole, with whitespace collapsed', () => {
    expect(trimFetched('  a \n\n b  ', undefined)).toBe('a b');
  });

  it('centres the window on the excerpt when it is found', () => {
    const text = `${'x '.repeat(500)}the excerpt starts here and goes on ${'y '.repeat(500)}`;
    const out = trimFetched(text, 'The   excerpt starts here and goes on', 100);
    expect(out).toHaveLength(100);
    expect(out).toContain('the excerpt starts here');
  });

  it('takes the start when the excerpt is missing, absent or empty', () => {
    const text = 'a'.repeat(MAX_FETCHED_CHARS + 10);
    expect(trimFetched(text, 'not there')).toBe('a'.repeat(MAX_FETCHED_CHARS));
    expect(trimFetched(text, undefined)).toHaveLength(MAX_FETCHED_CHARS);
    expect(trimFetched(text, '   ')).toHaveLength(MAX_FETCHED_CHARS);
  });

  it('keeps a full window when the excerpt is near the end', () => {
    const text = `${'x'.repeat(300)} tail words`;
    expect(trimFetched(text, 'tail words', 100)).toBe(text.slice(-100));
  });
});

describe('fetchSourceTexts', () => {
  const web = (id: string, url: string, extra: object = {}): Passage['sources'][number] =>
    ({
      id,
      type: 'web',
      citation: id,
      url,
      retrievedAt: '2026-09-01T08:30:00Z',
      ...extra,
    }) as Passage['sources'][number];

  it('fetches each web URL once, with the archive fallback, and records failures as missing', async () => {
    const fetcher = new MemorySourceFetcher({
      'https://a.example/': { text: 'page a' },
      'https://archive.example/b': { text: 'archived b' },
      'https://c.example/': { text: '  ' },
    });
    const failing: SourceFetcher = {
      fetch: (url) => (url === 'https://d.example/' ? Promise.reject(new Error('offline')) : fetcher.fetch(url)),
    };
    const sources = [
      web('a', 'https://a.example/'),
      web('a2', 'https://a.example/'),
      web('b', 'https://b.example/', { archivedUrl: 'https://archive.example/b' }),
      web('c', 'https://c.example/'),
      web('d', 'https://d.example/'),
      { id: 'p', type: 'print', citation: 'A book' },
      { id: 's', type: 'scripture', citation: 'Mt 1:1', ref: 'Mt 1:1', url: 'https://s.example/' },
    ] as Passage['sources'];
    const viaArchive = await fetchSourceTexts(passage(sources, ['a']), fetcher);
    expect(viaArchive.get('https://b.example/')).toBe('archived b');
    const texts = await fetchSourceTexts(passage(sources, ['a']), failing);
    expect([...texts.entries()]).toEqual([
      ['https://a.example/', 'page a'],
      ['https://b.example/', undefined],
      ['https://c.example/', undefined],
      ['https://d.example/', undefined],
    ]);
    expect(fetcher.fetched.filter((url) => url === 'https://a.example/')).toHaveLength(2);
  });
});

describe('claimInput', () => {
  it('passes only the claim id and text and its cited sources, with fetched text', () => {
    const sources = [
      {
        id: 'w',
        type: 'web',
        citation: 'Web page',
        url: 'https://w.example/',
        retrievedAt: '2026-09-01T08:30:00Z',
        excerpt: 'Ein Auszug',
        excerptLang: 'de',
        archivedUrl: 'https://archive.example/w',
      },
      { id: 's', type: 'scripture', citation: 'Dt 15:9', ref: 'Dt 15:9' },
      { id: 'unused', type: 'print', citation: 'Not cited' },
    ] as Passage['sources'];
    const input = claimInput(
      passage(sources, ['w', 's', 'missing'])['claims'][0] as Passage['claims'][number],
      passage(sources, []),
      new Map([['https://w.example/', 'fetched page text']]),
    );
    expect(input).toEqual({
      claim: { id: 'c1', text: 'A claim.' },
      sources: [
        {
          id: 'w',
          type: 'web',
          citation: 'Web page',
          url: 'https://w.example/',
          excerpt: 'Ein Auszug',
          excerptLang: 'de',
          fetchedText: 'fetched page text',
        },
        { id: 's', type: 'scripture', citation: 'Dt 15:9', ref: 'Dt 15:9' },
      ],
    });
  });
});
