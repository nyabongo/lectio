import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { loadFixture, loadFixtures } from '../../fixtures/load.ts';
import { formatErrors } from '../common/index.ts';
import {
  CONTEXT_PARAGRAPH_PATTERN,
  FORBIDDEN_PASSAGE_FIELDS,
  PASSAGE_SCHEMA_VERSION,
  passageSchema,
  validatePassage,
} from './index.ts';
import type { Passage, PassageReview } from './index.ts';

/** Every invalid fixture and the error (instance path, ajv keyword) that must be among the reported ones. */
const EXPECTED_FAILURES: Record<string, [instancePath: string, keyword: string]> = {
  'anchor-too-long': ['/translationNotes/0/anchor', 'pattern'],
  'note-body-without-marker': ['/translationNotes/0/body', 'pattern'],
  'verifier-summary-flat': ['/review/verifierSummary/refuter', 'type'],
  'approved-without-approved-via': ['/review', 'required'],
  'approved-without-method': ['/review', 'required'],
  'auto-via-label': ['/review/approvedVia', 'const'],
  'auto-without-verifier-summary': ['/review', 'required'],
  'bad-claim-id': ['/claims/0/id', 'pattern'],
  'bad-key': ['/key', 'pattern'],
  'bad-original-lang': ['/translationNotes/0/original/lang', 'enum'],
  'claim-without-sources': ['/claims/0/sourceIds', 'minItems'],
  'human-via-auto': ['/review/approvedVia', 'enum'],
  'human-without-reviewers': ['/review/reviewers', 'minItems'],
  'impossible-created-at': ['/provenance/createdAt', 'format'],
  'missing-review': ['', 'required'],
  'paragraph-without-marker': ['/context/paragraphs/0', 'pattern'],
  'pending-with-approved-via': ['/review', 'not'],
  'pending-with-method': ['/review', 'not'],
  'research-without-models': ['/provenance/models', 'minItems'],
  'scripture-source-without-ref': ['/sources/0', 'required'],
  'summary-too-long': ['/summary', 'maxLength'],
  'text-field': ['', 'propertyNames'],
  'verses-field': ['', 'propertyNames'],
  'web-source-without-url': ['/sources/4', 'required'],
  'wrong-schema-version': ['/schemaVersion', 'const'],
};

const pending = loadFixture('passage', 'valid', 'pending') as Passage;

function withReview(review: Record<string, unknown>): unknown {
  return { ...pending, review };
}

function errorsOf(data: unknown): [string, string][] {
  expect(validatePassage(data)).toBe(false);
  return (validatePassage.errors ?? []).map((error) => [error.instancePath, error.keyword]);
}

describe('passage fixtures', () => {
  const valid = loadFixtures('passage', 'valid');
  const invalid = loadFixtures('passage', 'invalid');

  it.each([...valid])('valid/%s passes', (_name, data) => {
    const ok = validatePassage(data);
    expect(formatErrors(ok ? [] : validatePassage.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it.each([...invalid])('invalid/%s fails for the expected reason', (name, data) => {
    const expected = EXPECTED_FAILURES[name];
    expect(expected, `add ${name} to EXPECTED_FAILURES`).toBeDefined();
    expect(errorsOf(data)).toContainEqual(expected);
  });

  it('has an expectation for every invalid fixture and a fixture for every expectation', () => {
    expect([...invalid.keys()].sort()).toEqual(Object.keys(EXPECTED_FAILURES).sort());
  });

  it('covers a pending, a human-approved and an auto-approved review block', () => {
    const statuses = [...valid.values()].map((data) => {
      const review = (data as Passage).review;
      return `${review.status}:${review.method ?? '-'}`;
    });
    expect(statuses).toEqual(expect.arrayContaining(['pending:-', 'approved:human', 'approved:auto']));
  });
});

describe('no reading text (ADR 0003)', () => {
  it.each(FORBIDDEN_PASSAGE_FIELDS)('rejects a passage-level %s field by name', (field) => {
    const errors = errorsOf({ ...pending, [field]: '(placeholder)' });
    expect(errors).toContainEqual(['', 'propertyNames']);
  });

  it('bans the fields by name even if additionalProperties were relaxed', () => {
    expect(passageSchema.propertyNames).toEqual({ not: { enum: ['text', 'verses'] } });
    expect(passageSchema.additionalProperties).toBe(false);
  });

  it('allows a nested `text` (claims and original words) but no other unknown top-level field', () => {
    expect(validatePassage(pending)).toBe(true);
    expect(errorsOf({ ...pending, reading: 'x' })).toContainEqual(['', 'additionalProperties']);
  });
});

describe('review block', () => {
  const verifierSummary = {
    confirmer: { model: 'a', minSupport: 0.95 },
    refuter: { model: 'b', minSupport: 0.9 },
    minSupport: 0.9,
    refutations: 0,
    sensitive: 0,
  };

  it('accepts pending with no method, and pending with a verifier summary from a flagged run', () => {
    expect(validatePassage(withReview({ status: 'pending', reviewers: [] }))).toBe(true);
    expect(validatePassage(withReview({ status: 'pending', reviewers: [], verifierSummary }))).toBe(true);
  });

  it('requires method and approvedVia once approved', () => {
    expect(errorsOf(withReview({ status: 'approved', reviewers: ['r'] }))).toEqual(
      expect.arrayContaining([
        ['/review', 'required'],
        ['/review', 'required'],
      ]),
    );
  });

  it('requires a verifierSummary and approvedVia auto for method auto', () => {
    expect(
      errorsOf(withReview({ status: 'approved', method: 'auto', approvedVia: 'auto', reviewers: [] })),
    ).toContainEqual(['/review', 'required']);
    expect(
      validatePassage(
        withReview({ status: 'approved', method: 'auto', approvedVia: 'auto', reviewers: [], verifierSummary }),
      ),
    ).toBe(true);
  });

  it.each(['cli', 'label', 'comment'])('accepts a human approval via %s', (approvedVia) => {
    expect(validatePassage(withReview({ status: 'approved', method: 'human', approvedVia, reviewers: ['r'] }))).toBe(
      true,
    );
  });

  it('bounds the verifier summary', () => {
    const review = { status: 'approved', method: 'auto', approvedVia: 'auto', reviewers: [] };
    expect(
      errorsOf(withReview({ ...review, verifierSummary: { ...verifierSummary, minSupport: 1.5 } })),
    ).toContainEqual(['/review/verifierSummary/minSupport', 'maximum']);
    expect(
      errorsOf(withReview({ ...review, verifierSummary: { ...verifierSummary, refutations: -1 } })),
    ).toContainEqual(['/review/verifierSummary/refutations', 'minimum']);
    const refuter = { model: 'b', minSupport: -0.1 };
    expect(errorsOf(withReview({ ...review, verifierSummary: { ...verifierSummary, refuter } }))).toContainEqual([
      '/review/verifierSummary/refuter/minSupport',
      'minimum',
    ]);
  });
});

describe('fields', () => {
  it('requires claim markers at the end of every context paragraph', () => {
    const re = new RegExp(CONTEXT_PARAGRAPH_PATTERN, 'u');
    expect(re.test('One. [c1] Two. [c2][c3]')).toBe(true);
    expect(re.test('One. [c1] Two.')).toBe(false);
    expect(re.test('[c1]')).toBe(false);
    expect(re.test('One [note]. [c1]')).toBe(false);
    expect(re.test('One. [c0]')).toBe(false);
  });

  it('accepts a summary of exactly 140 characters', () => {
    expect(validatePassage({ ...pending, summary: 'x'.repeat(140) })).toBe(true);
  });

  it('requires excerptLang to come with an excerpt and accepts locales or original languages', () => {
    const sources = pending.sources.map((source) => ({ ...source }));
    sources[0] = { ...sources[0]!, excerptLang: 'en' } as (typeof sources)[number];
    expect(errorsOf({ ...pending, sources })).toContainEqual(['/sources/0', 'dependentRequired']);
    sources[0] = { ...sources[0], excerpt: 'word', excerptLang: 'hbo' } as (typeof sources)[number];
    expect(validatePassage({ ...pending, sources })).toBe(true);
  });

  it('accepts Aramaic originals', () => {
    const [note] = pending.translationNotes;
    const original = { text: 'טַלְיְתָא קוּמִי', lang: 'arc', translit: 'talyeta qumi', gloss: 'little girl, arise' };
    expect(validatePassage({ ...pending, translationNotes: [{ ...note, original }] })).toBe(true);
  });

  it('pins the schema version', () => {
    expect(PASSAGE_SCHEMA_VERSION).toBe(1);
    expect(pending.schemaVersion).toBe(PASSAGE_SCHEMA_VERSION);
  });
});

describe('types', () => {
  it('derives the TypeScript type from the schema', () => {
    expectTypeOf<Passage['key']>().toEqualTypeOf<string>();
    expectTypeOf<Passage['schemaVersion']>().toEqualTypeOf<1>();
    expectTypeOf<PassageReview['status']>().toEqualTypeOf<'pending' | 'approved'>();
    expectTypeOf<Passage['translationNotes'][number]['original']['lang']>().toEqualTypeOf<
      'grc' | 'hbo' | 'arc' | 'lat'
    >();
    expectTypeOf<Passage>().not.toHaveProperty('text');
  });
});

describe('docs/content-model.md', () => {
  const doc = readFileSync(fileURLToPath(new URL('../../../../docs/content-model.md', import.meta.url)), 'utf8');
  const blocks = (tag: string) =>
    [...doc.matchAll(new RegExp('```json ' + tag + '\\n([\\s\\S]*?)\\n```', 'g'))].map(
      (m) => JSON.parse(m[1]!) as unknown,
    );

  it('has a passage example that validates', () => {
    const [example] = blocks('passage');
    expect(example).toBeDefined();
    expect(formatErrors(validatePassage(example) ? [] : validatePassage.errors)).toEqual([]);
  });

  it('has pending, human and auto review examples that validate inside the passage example', () => {
    const [example] = blocks('passage') as Passage[];
    const reviews = blocks('review') as PassageReview[];
    expect(reviews.map((review) => `${review.status}:${review.method ?? '-'}`)).toEqual([
      'pending:-',
      'approved:human',
      'approved:auto',
    ]);
    for (const review of reviews) {
      expect(formatErrors(validatePassage({ ...example, review }) ? [] : validatePassage.errors)).toEqual([]);
    }
  });
});
