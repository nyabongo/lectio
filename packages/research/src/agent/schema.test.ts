import { DEFAULT_CONFIG } from '@lectio/config';
import { generateFromSchema, validateAgainstSchema } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { MT_20_OUTPUT } from './fixtures/fake-research.ts';
import { MAX_TRANSLATION_NOTES, RESEARCH_RESPONSE_SCHEMA, excerptWordLimit } from './schema.ts';

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

  it('leaves the excerpt word limit to the prompt and the licence gate', () => {
    const words = Array.from({ length: 20 }, (_, i) => `w${String(i)}`).join(' ');
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, withSource({ excerpt: words }))).toEqual([]);
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, withSource({ excerpt: ' padded' }))).not.toEqual([]);
  });

  it(`allows at most ${String(MAX_TRANSLATION_NOTES)} translation notes`, () => {
    const [note] = MT_20_OUTPUT.translationNotes;
    const notes = (n: number) => ({ ...MT_20_OUTPUT, translationNotes: Array.from({ length: n }, () => note) });
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, notes(MAX_TRANSLATION_NOTES))).toEqual([]);
    expect(validateAgainstSchema(RESEARCH_RESPONSE_SCHEMA, notes(MAX_TRANSLATION_NOTES + 1))).not.toEqual([]);
  });
});

describe('excerptWordLimit', () => {
  it('is the tightest of the licence guard limits', () => {
    expect(excerptWordLimit(DEFAULT_CONFIG.licenceGuard)).toBe(12);
    expect(excerptWordLimit({ maxExcerptWords: 9, maxCommentaryRunWords: 12, maxBibleRunWords: 12 })).toBe(9);
    expect(excerptWordLimit({ maxExcerptWords: 25, maxCommentaryRunWords: 12, maxBibleRunWords: 7 })).toBe(7);
  });
});
