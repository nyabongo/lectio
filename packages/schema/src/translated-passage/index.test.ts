import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { loadFixture } from '../../fixtures/load.ts';
import { formatErrors } from '../common/index.ts';
import type { Passage } from '../passage/index.ts';
import {
  TRANSLATED_PASSAGE_SCHEMA_VERSION,
  TRANSLATIONS_DIR,
  citedClaimIds,
  parseTranslatedPassagePath,
  translatableFields,
  translatableSha256,
  translatedPassagePath,
  translatedPassageSchema,
  translationMismatches,
  validateTranslatedPassage,
} from './index.ts';
import type { TranslatedPassage, TranslationReview } from './index.ts';

const english = loadFixture('passage', 'valid', 'pending') as Passage;
const pending = JSON.parse(
  readFileSync(new URL('./fixtures/valid/pending.json', import.meta.url), 'utf8'),
) as TranslatedPassage;

type Json = Record<string, unknown>;

function clone(): Json {
  return structuredClone(pending) as unknown as Json;
}

function errorsOf(data: unknown): [string, string][] {
  expect(validateTranslatedPassage(data)).toBe(false);
  return (validateTranslatedPassage.errors ?? []).map((error) => [error.instancePath, error.keyword]);
}

function withReview(review: Json): Json {
  return { ...clone(), review };
}

describe('translated-passage schema', () => {
  it('accepts the Swahili fixture of the English pending passage', () => {
    const ok = validateTranslatedPassage(pending);
    expect(formatErrors(ok ? [] : validateTranslatedPassage.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it('accepts a human approval', () => {
    const review = {
      status: 'approved',
      method: 'human',
      reviewers: ['fr-reviewer'],
      approvedVia: 'label',
      lastReviewedAt: '2026-10-06T09:00:00Z',
    };
    expect(validateTranslatedPassage(withReview(review))).toBe(true);
  });

  /** Each mutation breaks one rule; the error (instance path, ajv keyword) must be reported. */
  const cases: [name: string, mutate: (data: Json) => void, expected: [string, string]][] = [
    ['English locale', (d) => (d['locale'] = 'en'), ['/locale', 'not']],
    ['regional English locale', (d) => (d['locale'] = 'en-KE'), ['/locale', 'not']],
    ['malformed locale', (d) => (d['locale'] = 'Swahili'), ['/locale', 'pattern']],
    ['short digest', (d) => (d['sourceSha256'] = 'abc'), ['/sourceSha256', 'pattern']],
    ['bad translationOf', (d) => (d['translationOf'] = 'Mt 20:1-16'), ['/translationOf', 'pattern']],
    ['missing sourceSha256', (d) => delete d['sourceSha256'], ['', 'required']],
    ['text field', (d) => (d['text'] = 'x'), ['', 'propertyNames']],
    ['verses field', (d) => (d['verses'] = []), ['', 'propertyNames']],
    ['sources are not translated', (d) => (d['sources'] = []), ['', 'additionalProperties']],
    [
      'paragraph without marker',
      (d) => ((d['context'] as { paragraphs: string[] }).paragraphs[0] = 'Hakuna alama.'),
      ['/context/paragraphs/0', 'pattern'],
    ],
    [
      'note body without marker',
      (d) => ((d['translationNotes'] as Json[])[0] as Json)['body'] = 'Hakuna alama.',
      ['/translationNotes/0/body', 'pattern'],
    ],
    [
      'note with original words',
      (d) => (((d['translationNotes'] as Json[])[0] as Json)['original'] = {}),
      ['/translationNotes/0', 'additionalProperties'],
    ],
    [
      'claim with sources',
      (d) => (((d['claims'] as Json[])[0] as Json)['sourceIds'] = ['x']),
      ['/claims/0', 'additionalProperties'],
    ],
    ['bad claim id', (d) => (((d['claims'] as Json[])[0] as Json)['id'] = 'C1'), ['/claims/0/id', 'pattern']],
    ['no claims', (d) => (d['claims'] = []), ['/claims', 'minItems']],
    ['summary too long', (d) => (d['summary'] = 'a'.repeat(201)), ['/summary', 'maxLength']],
    ['wrong schema version', (d) => (d['schemaVersion'] = 2), ['/schemaVersion', 'const']],
    [
      'auto approval',
      (d) =>
        (d['review'] = {
          status: 'approved',
          method: 'auto',
          reviewers: [],
          approvedVia: 'auto',
        }),
      ['/review/method', 'const'],
    ],
    [
      'human approval without reviewers',
      (d) => (d['review'] = { status: 'approved', method: 'human', reviewers: [], approvedVia: 'cli' }),
      ['/review/reviewers', 'minItems'],
    ],
    [
      'approved without method',
      (d) => (d['review'] = { status: 'approved', reviewers: ['a'], approvedVia: 'cli' }),
      ['/review', 'required'],
    ],
    [
      'pending with method',
      (d) => (d['review'] = { status: 'pending', reviewers: [], method: 'human' }),
      ['/review', 'not'],
    ],
    [
      'verifier summary',
      (d) => (d['review'] = { status: 'pending', reviewers: [], verifierSummary: {} }),
      ['/review', 'additionalProperties'],
    ],
  ];

  it.each(cases)('rejects: %s', (_name, mutate, expected) => {
    const data = clone();
    mutate(data);
    expect(errorsOf(data)).toContainEqual(expected);
  });

  it('is identified and versioned', () => {
    expect(translatedPassageSchema.$id).toMatch(/translated-passage\.schema\.json$/);
    expect(pending.schemaVersion).toBe(TRANSLATED_PASSAGE_SCHEMA_VERSION);
  });

  it('derives types from the schema', () => {
    expectTypeOf<TranslatedPassage['locale']>().toEqualTypeOf<string>();
    expectTypeOf<TranslationReview['status']>().toEqualTypeOf<'pending' | 'approved'>();
  });
});

describe('translation paths', () => {
  it('builds and parses passages/i18n/<locale>/<key>.json', () => {
    const path = translatedPassagePath('sw', 'MT.20.1-16');
    expect(path).toBe(`${TRANSLATIONS_DIR}/sw/MT.20.1-16.json`);
    expect(parseTranslatedPassagePath(path)).toEqual({ locale: 'sw', key: 'MT.20.1-16' });
    expect(parseTranslatedPassagePath('passages/i18n/pt-BR/PS.23.json')).toEqual({ locale: 'pt-BR', key: 'PS.23' });
  });

  it.each([
    'passages/MT.20.1-16.json',
    'passages/i18n/sw/MT.20.1-16.txt',
    'passages/i18n/sw/extra/MT.20.1-16.json',
    'passages/i18n/en/MT.20.1-16.json',
    'passages/i18n/en-KE/MT.20.1-16.json',
    'passages/i18n/Swahili/MT.20.1-16.json',
    'passages/i18n/sw/mt-20.json',
    'content/passages/i18n/sw/MT.20.1-16.json',
  ])('is not a translation: %s', (path) => {
    expect(parseTranslatedPassagePath(path)).toBeNull();
  });
});

describe('translatableSha256', () => {
  it('hashes the translatable fields of the English passage', () => {
    expect(translatableSha256(english)).toBe(pending.sourceSha256);
    expect(translatableSha256(english)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lists exactly what a translator renders', () => {
    const fields = translatableFields(english);
    expect(Object.keys(fields)).toEqual(['summary', 'context', 'translationNotes', 'claims']);
    expect(fields.translationNotes[0]).toEqual({
      id: 'evil-eye',
      anchor: 'envious',
      gloss: 'your eye evil',
      summary: english.translationNotes[0]?.summary,
      body: english.translationNotes[0]?.body,
    });
    expect(fields.claims.map((claim) => claim.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('changes when a translatable field changes', () => {
    const changed = structuredClone(english);
    (changed.claims[0] as { text: string }).text = 'Changed.';
    expect(translatableSha256(changed)).not.toBe(pending.sourceSha256);
  });

  it('ignores sources, provenance and review', () => {
    const changed = structuredClone(english) as unknown as Json;
    changed['sources'] = [];
    changed['provenance'] = {};
    changed['review'] = { status: 'approved' };
    expect(translatableSha256(changed as unknown as Passage)).toBe(pending.sourceSha256);
  });
});

describe('citedClaimIds', () => {
  it('lists distinct markers, sorted', () => {
    expect(citedClaimIds('a [c3] b [c1][c3]')).toEqual(['c1', 'c3']);
    expect(citedClaimIds('none')).toEqual([]);
  });
});

describe('translationMismatches', () => {
  const mutated = (mutate: (data: TranslatedPassage) => void): TranslatedPassage => {
    const data = structuredClone(pending);
    mutate(data);
    return data;
  };

  it('is empty for a translation that lines up', () => {
    expect(translationMismatches(english, pending)).toEqual([]);
  });

  it('names a translation of another passage', () => {
    const other = mutated((d) => (d.translationOf = 'MT.20.1-15'));
    expect(translationMismatches(english, other)).toEqual([
      { pointer: '/translationOf', message: 'translationOf MT.20.1-15 is not the English passage MT.20.1-16' },
    ]);
  });

  it('names missing, extra and repeated notes and claims', () => {
    const data = mutated((d) => {
      (d.translationNotes[1] as { id: string }).id = 'evil-eye';
      d.claims.push({ id: 'c9', text: 'Ziada.' });
      d.claims.splice(1, 1);
    });
    expect(translationMismatches(english, data)).toEqual([
      { pointer: '/translationNotes/1/id', message: 'translation note evil-eye is translated more than once' },
      { pointer: '/translationNotes', message: 'translation notes missing from the translation: agathos' },
      { pointer: '/claims/4/id', message: 'claim c9 is not in the English passage' },
      { pointer: '/claims', message: 'claims missing from the translation: c2' },
      {
        pointer: '/translationNotes/1/body',
        message: 'cites claims c5, but the English text cites c3, c4',
      },
    ]);
  });

  it('names a different paragraph count and different markers', () => {
    const data = mutated((d) => {
      d.context.paragraphs = ['Aya moja tu. [c1][c9]'];
      (d.translationNotes[0] as { body: string }).body = 'Mwili. [c3]';
    });
    expect(translationMismatches(english, data)).toEqual([
      { pointer: '/context/paragraphs', message: 'has 1 paragraphs, but the English context has 2' },
      { pointer: '/context/paragraphs/0', message: 'cites claims c1, c9, but the English text cites c1, c2' },
      { pointer: '/translationNotes/0/body', message: 'cites claims c3, but the English text cites c3, c4' },
    ]);
  });

  it('skips marker checks for notes and paragraphs the English file lacks', () => {
    const data = mutated((d) => {
      (d.translationNotes[0] as { id: string }).id = 'unknown';
      d.context.paragraphs.push('Ziada. [c1]');
    });
    expect(translationMismatches(english, data).map((m) => m.pointer)).toEqual([
      '/translationNotes/0/id',
      '/translationNotes',
      '/context/paragraphs',
    ]);
  });

  it('says none when a text cites nothing the English one cites', () => {
    const data = mutated((d) => ((d.translationNotes[1] as { body: string }).body = 'Hakuna alama.'));
    expect(translationMismatches(english, data)).toEqual([
      { pointer: '/translationNotes/1/body', message: 'cites claims none, but the English text cites c5' },
    ]);
  });
});
