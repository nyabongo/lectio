import { describe, expect, it } from 'vitest';

import { englishWordCount, excerptFields, noteFields, preview, quotedSpans, webSources, wordCount } from './text.ts';

const inner = (text: string): string[] => quotedSpans(text).map((span) => text.slice(span.start, span.end));

describe('noteFields', () => {
  it('lists every prose field with its pointer and claim id', () => {
    const passage = {
      summary: 'S',
      context: { title: 'T', paragraphs: ['P0 [c1]', 7, '   ', '[c2]'] },
      translationNotes: [
        { summary: 'NS', body: 'NB [c12]', original: { gloss: 'G' } },
        'not a note',
        { summary: 'NS2', original: 'not an object' },
      ],
      claims: [{ id: 'c1', text: 'C1' }, { text: 'no id' }, null],
    };
    expect(noteFields(passage)).toEqual([
      { pointer: '/summary', text: 'S' },
      { pointer: '/context/title', text: 'T' },
      { pointer: '/context/paragraphs/0', text: 'P0     ' },
      { pointer: '/translationNotes/0/summary', text: 'NS' },
      { pointer: '/translationNotes/0/body', text: `NB${' '.repeat(6)}` },
      { pointer: '/translationNotes/0/original/gloss', text: 'G' },
      { pointer: '/translationNotes/2/summary', text: 'NS2' },
      { pointer: '/claims/0/text', text: 'C1', claimId: 'c1' },
      { pointer: '/claims/1/text', text: 'no id' },
    ]);
  });

  it('reads nothing from a non-object or a passage without fields', () => {
    expect(noteFields(null)).toEqual([]);
    expect(noteFields([])).toEqual([]);
    expect(noteFields({ context: 'x', claims: 'x' })).toEqual([]);
  });
});

describe('excerptFields and webSources', () => {
  const passage = {
    sources: [
      { id: 'a', type: 'web', url: 'https://a.example/', excerpt: 'from a' },
      { type: 'web', url: 'https://b.example/', archivedUrl: 'https://web.archive.org/b', excerpt: 'from b' },
      { id: 'c', type: 'print', excerpt: 'from c' },
      { id: 'd', type: 'web', url: '  ' },
      { id: 'e', type: 'web' },
      'junk',
    ],
  };

  it('lists excerpts with their source id, or the index when the id is missing', () => {
    expect(excerptFields(passage)).toEqual([
      { pointer: '/sources/0/excerpt', sourceId: 'a', text: 'from a' },
      { pointer: '/sources/1/excerpt', sourceId: '#1', text: 'from b' },
      { pointer: '/sources/2/excerpt', sourceId: 'c', text: 'from c' },
    ]);
    expect(excerptFields('x')).toEqual([]);
  });

  it('lists web sources with a URL, keeping the archived URL', () => {
    expect(webSources(passage)).toEqual([
      { pointer: '/sources/0', sourceId: 'a', url: 'https://a.example/' },
      { pointer: '/sources/1', sourceId: '#1', url: 'https://b.example/', archivedUrl: 'https://web.archive.org/b' },
    ]);
    expect(webSources(undefined)).toEqual([]);
  });
});

describe('word counts', () => {
  it('counts words the way the guard tokenises them (verse numbers are not words)', () => {
    expect(wordCount('The owner’s question, 15 is it fair?')).toBe(6);
    expect(wordCount('')).toBe(0);
  });

  it('counts only Latin-script words as English', () => {
    expect(englishWordCount('ὀφθαλμός σου πονηρός, your eye evil')).toBe(3);
  });
});

describe('quotedSpans', () => {
  it('finds curly, straight and guillemet double quotes', () => {
    expect(inner('He asks “is your eye evil?” and "why stand idle" or «friend».')).toEqual([
      'is your eye evil?',
      'why stand idle',
      'friend',
    ]);
  });

  it('runs an unclosed double quote to the end of the text', () => {
    const text = 'He said “go into the vineyard';
    expect(quotedSpans(text)).toEqual([{ start: 9, end: text.length, unterminated: true }]);
  });

  it('pairs mismatched and regional double quotes', () => {
    expect(inner('He said “why stand idle" and left.')).toEqual(['why stand idle']);
    expect(inner('Luther: „one two three“ and Swedish ”a b c d e f g h i j k l” end.')).toEqual([
      'one two three',
      'a b c d e f g h i j k l',
    ]);
    expect(inner('A 6" board, 2"x4", is not a quotation.')).toEqual([]);
    expect(inner('(“first”) and "second".')).toEqual(['first', 'second']);
  });

  it('finds single quotes but not apostrophes', () => {
    expect(inner('The owner’s ‘friend’ and the workers’ pay')).toEqual(['friend']);
    expect(inner("He called him 'friend', not 'servant'.")).toEqual(['friend', 'servant']);
    expect(inner('(‘last’) and —‘first’')).toEqual(['last', 'first']);
    expect(inner('‘ spaced’ is not a quote; ’tis neither, nor workers’')).toEqual([]);
  });

  it('ignores an unclosed single quote', () => {
    expect(inner('He said ‘go into the vineyard')).toEqual([]);
  });

  it('reports nested quotes on their own, ordered by start', () => {
    expect(inner('“He said ‘friend’ to him”')).toEqual(['He said ‘friend’ to him', 'friend']);
  });
});

describe('preview', () => {
  it('shows up to eight words with an ellipsis when cut', () => {
    expect(preview('one two three four five six seven eight nine ten')).toBe(
      'one two three four five six seven eight…',
    );
    expect(preview('  one,\n two  ')).toBe('one, two');
    expect(preview('xx one two yy', 3, 10)).toBe('one two');
  });

  it('falls back to the trimmed slice when there are no words', () => {
    expect(preview(' … ')).toBe('…');
  });
});
