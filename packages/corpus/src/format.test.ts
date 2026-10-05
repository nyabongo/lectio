import { describe, expect, it } from 'vitest';

import {
  assertBookCode,
  assertEditionId,
  compareVerseKeys,
  CorpusError,
  parseChapter,
  parseSource,
  segment,
  serialiseChapter,
  serialiseSource,
} from './format.ts';
import type { SourceInfo } from './format.ts';

const source: SourceInfo = {
  name: 'Test',
  language: 'grc',
  upstreamUrl: 'https://example.test/a.tar.gz',
  version: 'v1',
  sha256: 'a'.repeat(64),
  licence: 'CC-BY-4.0',
  attribution: 'Someone',
  versification: 'NABRE',
};

describe('parseSource', () => {
  it('accepts a complete SOURCE.json and returns a copy in field order', () => {
    const shuffled = { ...source, name: source.name };
    expect(parseSource(shuffled, 'x')).toEqual(source);
    expect(Object.keys(parseSource(shuffled, 'x'))[0]).toBe('name');
  });

  it.each([
    [null, 'expected an object'],
    [[], 'expected an object'],
    [{ ...source, name: '' }, '"name" must be a non-empty string'],
    [{ ...source, sha256: 5 }, '"sha256" must be a non-empty string'],
    [{ ...source, extra: 'x' }, 'unknown field(s) extra'],
    [{ ...source, language: 'eng' }, '"language" must be one of grc, hbo, arc, lat'],
    [{ ...source, sha256: 'A'.repeat(64) }, '"sha256" must be 64 lower-case hex digits'],
  ])('rejects %j', (value, message) => {
    expect(() => parseSource(value, 'corpus/x/SOURCE.json')).toThrow(new CorpusError(`corpus/x/SOURCE.json: ${message}`));
  });
});

describe('parseChapter', () => {
  it('accepts tokens with and without morphology', () => {
    const chapter = { '1': [['a', 'b'], ['c', '', 'M']], '2': [] };
    expect(parseChapter(chapter, 'f')).toBe(chapter);
  });

  it.each([
    ['x', 'expected an object of verses'],
    [{ 'a b': [] }, 'invalid verse key "a b"'],
    [{ '07': [] }, 'invalid verse key "07"'],
    [{ '1': 'x' }, 'verse 1 must be an array of tokens'],
    [{ '1': [['only']] }, 'verse 1 token 0 must be [surface, lemma, morph?]'],
    [{ '1': [['a', 'b'], ['a', 'b', 'c', 'd']] }, 'verse 1 token 1 must be [surface, lemma, morph?]'],
    [{ '1': [['a', 1]] }, 'verse 1 token 0 must be [surface, lemma, morph?]'],
    [{ '1': [['', 'b']] }, 'verse 1 token 0 must be [surface, lemma, morph?]'],
    [{ '1': ['ab'] }, 'verse 1 token 0 must be [surface, lemma, morph?]'],
  ])('rejects %j', (value, message) => {
    expect(() => parseChapter(value, 'f')).toThrow(`f: ${message}`);
  });
});

describe('identifiers', () => {
  it('validates edition ids, book codes and chapter/verse segments', () => {
    expect(() => assertEditionId('grc-sblgnt')).not.toThrow();
    expect(() => assertEditionId('../x')).toThrow(CorpusError);
    expect(() => assertEditionId('Grc')).toThrow('invalid edition id: "Grc"');
    expect(() => assertBookCode('1COR')).not.toThrow();
    expect(() => assertBookCode('mt')).toThrow('invalid book code: "mt"');
    expect(segment('chapter', 20)).toBe('20');
    expect(segment('verse', 'A')).toBe('A');
    expect(() => segment('verse', '1/2')).toThrow('invalid verse: "1/2"');
    expect(() => segment('chapter', 1.5)).toThrow('invalid chapter: 1.5');
    expect(() => segment('chapter', '01')).toThrow('invalid chapter: "01"');
    expect(segment('verse', 0)).toBe('0');
    expect(segment('verse', '10a')).toBe('10a');
  });
});

describe('compareVerseKeys', () => {
  it('orders numerically, then suffixes, then non-numeric keys', () => {
    expect(['10', 'A', '2', '10a', '1', 'B', '0'].sort(compareVerseKeys)).toEqual([
      '0',
      '1',
      '2',
      '10',
      '10a',
      'A',
      'B',
    ]);
    expect(compareVerseKeys('3', '3')).toBe(0);
    expect(compareVerseKeys('B', 'A')).toBe(1);
    expect(compareVerseKeys('10b', '10a')).toBe(1);
    expect(compareVerseKeys('10a', '10b')).toBe(-1);
    expect(compareVerseKeys('A', '1')).toBe(1);
    expect(compareVerseKeys('1', 'A')).toBe(-1);
  });
});

describe('serialisation', () => {
  it('writes one verse per line in verse order', () => {
    expect(serialiseChapter({ '10': [['b', 'b']], '2': [['a', 'a', 'M']] })).toBe(
      '{\n  "2": [["a","a","M"]],\n  "10": [["b","b"]]\n}\n',
    );
    expect(serialiseChapter({})).toBe('{}\n');
  });

  it('round-trips through parseChapter', () => {
    const verses = { '1': [['ἐν', 'ἐν']] as const, '2': [['ἀρχῇ', 'ἀρχή', 'N-DSF']] as const };
    expect(parseChapter(JSON.parse(serialiseChapter(verses)), 'f')).toEqual(verses);
  });

  it('writes SOURCE.json fields in documented order', () => {
    const reordered = Object.fromEntries(Object.entries(source).reverse()) as unknown as SourceInfo;
    const text = serialiseSource(reordered);
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'name',
      'language',
      'upstreamUrl',
      'version',
      'sha256',
      'licence',
      'attribution',
      'versification',
    ]);
    expect(parseSource(JSON.parse(text), 'x')).toEqual(source);
  });
});
