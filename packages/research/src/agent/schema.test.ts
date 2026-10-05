import { generateFromSchema, validateAgainstSchema } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { MT_20_OUTPUT } from './fixtures/fake-research.ts';
import { MAX_EXCERPT_WORDS, RESEARCH_RESPONSE_SCHEMA, wordsPattern } from './schema.ts';

const source = MT_20_OUTPUT.sources.find((s) => s.type === 'web')!;

function withSource(patch: Record<string, unknown>): unknown {
  return { ...MT_20_OUTPUT, sources: [{ ...source, ...patch }] };
}

describe('RESEARCH_RESPONSE_SCHEMA', () => {
  it('accepts the Mt 20 fixture', () => {
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, MT_20_OUTPUT)).toEqual([]);
  });

  it('lets the fake LLM generate a default answer', () => {
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, generateFromSchema(RESEARCH_RESPONSE_SCHEMA, 'x'))).toEqual(
      [],
    );
  });

  it('leaves the identity fields, note ids, provenance and review to the assembler', () => {
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, { ...MT_20_OUTPUT, key: 'MT.20.1-16' })).not.toEqual([]);
    const note = { id: 'evil-eye', ...MT_20_OUTPUT.translationNotes[0] };
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, { ...MT_20_OUTPUT, translationNotes: [note] })).not.toEqual(
      [],
    );
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, { ...MT_20_OUTPUT, text: 'x' })).not.toEqual([]);
  });

  it('lets a web source leave out retrievedAt but not its url', () => {
    const { retrievedAt: _r, ...noDate } = source;
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, { ...MT_20_OUTPUT, sources: [noDate] })).toEqual([]);
    const { url: _u, ...noUrl } = source;
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, { ...MT_20_OUTPUT, sources: [noUrl] })).not.toEqual([]);
  });

  it('requires a ref on scripture sources', () => {
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, withSource({ type: 'scripture' }))).not.toEqual([]);
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, withSource({ type: 'scripture', ref: 'Mt 6:22' }))).toEqual(
      [],
    );
  });

  it(`caps excerpts at ${String(MAX_EXCERPT_WORDS)} words`, () => {
    const words = (n: number): string => Array.from({ length: n }, (_, i) => `w${String(i)}`).join(' ');
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, withSource({ excerpt: words(12) }))).toEqual([]);
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, withSource({ excerpt: words(13) }))).not.toEqual([]);
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, withSource({ excerpt: ' padded' }))).not.toEqual([]);
  });
});

describe('wordsPattern', () => {
  it('matches one to n single-spaced words', () => {
    const re = new RegExp(wordsPattern(3), 'u');
    expect(['a', 'a b', 'a b c'].every((s) => re.test(s))).toBe(true);
    expect(['', 'a b c d', 'a  b', 'a '].some((s) => re.test(s))).toBe(false);
  });
});
