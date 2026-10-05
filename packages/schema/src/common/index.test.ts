import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  LITURGICAL_COLOURS,
  PASSAGE_KEY_PATTERN,
  READING_SLOTS,
  SCHEMA_ID_BASE,
  createAjv,
  formatErrors,
  isAbsoluteUrl,
  isIsoDateTime,
  isoDateSchema,
  isoDateTimeSchema,
  localeSchema,
  nonEmptyStringSchema,
  passageKeySchema,
  schemaId,
  slugSchema,
  urlSchema,
} from './index.ts';

const ajv = createAjv();
const check = (schema: object, value: unknown) => ajv.validate(schema, value);

describe('passage keys (ADR 0004)', () => {
  const key = new RegExp(PASSAGE_KEY_PATTERN, 'u');

  it.each([
    'MT.20.1-16',
    'PHIL.1.20-24_1.27',
    'PS.145.2-3_145.8-9_145.17-18',
    'ECCL.11.9-12.8',
    '1COR.13.4-13',
    '3JN.1.5-8',
    'ACTS.2.1',
    'GN.1.1-2.2',
  ])('accepts %s', (value) => {
    expect(key.test(value)).toBe(true);
    expect(check(passageKeySchema, value)).toBe(true);
  });

  it.each([
    'Mt 20:1-16',
    'mt.20.1-16',
    'MT.20.1-16a',
    'MT.20',
    'MT.0.1',
    'MT.20.01',
    '4MACC.1.1',
    'MT.20.1-16_',
    'MT.20.1-16,27',
    'MT.20.1-16 ',
    '../MT.20.1',
  ])('rejects %s', (value) => {
    expect(key.test(value)).toBe(false);
  });

  it('only ever matches file-name-safe characters', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        if (key.test(value)) expect(value).toMatch(/^[A-Z0-9._-]+$/);
      }),
    );
  });
});

describe('fragments', () => {
  it('validates real ISO dates only', () => {
    expect(check(isoDateSchema, '2028-02-29')).toBe(true);
    expect(check(isoDateSchema, '2026-02-29')).toBe(false);
    expect(check(isoDateSchema, '2026-9-20')).toBe(false);
  });

  it('validates RFC 3339 timestamps with an offset', () => {
    expect(check(isoDateTimeSchema, '2026-09-01T08:30:00Z')).toBe(true);
    expect(check(isoDateTimeSchema, '2026-09-01T08:30:00.123+03:00')).toBe(true);
    expect(check(isoDateTimeSchema, '2026-09-01T08:30:00')).toBe(false);
    expect(check(isoDateTimeSchema, '2026-09-31T08:30:00Z')).toBe(false);
    expect(check(isoDateTimeSchema, '2026-09-01T24:00:00Z')).toBe(false);
    expect(isIsoDateTime('2026-09-01')).toBe(false);
  });

  it('validates absolute http(s) URLs', () => {
    expect(check(urlSchema, 'https://www.drbo.org/chapter/47020.htm')).toBe(true);
    expect(check(urlSchema, 'http://example.org')).toBe(true);
    expect(check(urlSchema, 'https://')).toBe(false);
    expect(check(urlSchema, '/relative')).toBe(false);
    expect(check(urlSchema, 'mailto:x@example.org')).toBe(false);
    expect(isAbsoluteUrl('urn:isbn:0451450523')).toBe(true);
    expect(isAbsoluteUrl('not a url')).toBe(false);
  });

  it.each(['en', 'en-KE', 'sw', 'pt-BR', 'zh-Hant', 'zh-Hant-TW', 'es-419', 'grc'])(
    'accepts the locale %s',
    (value) => {
      expect(check(localeSchema, value)).toBe(true);
    },
  );

  it.each(['EN', 'en_KE', 'en-ke', 'english', ''])('rejects the locale %j', (value) => {
    expect(check(localeSchema, value)).toBe(false);
  });

  it('validates slugs and trimmed non-empty strings', () => {
    expect(check(slugSchema, 'evil-eye')).toBe(true);
    expect(check(slugSchema, 'Evil-Eye')).toBe(false);
    expect(check(slugSchema, 'evil--eye')).toBe(false);
    expect(check(nonEmptyStringSchema, 'a')).toBe(true);
    expect(check(nonEmptyStringSchema, 'a b')).toBe(true);
    expect(check(nonEmptyStringSchema, '')).toBe(false);
    expect(check(nonEmptyStringSchema, ' a')).toBe(false);
  });
});

describe('enums', () => {
  it('lists the liturgical colours', () => {
    expect(LITURGICAL_COLOURS).toEqual(['white', 'red', 'green', 'violet', 'rose', 'black', 'gold']);
  });

  it('lists the reading slots, including the numbered Vigil slots', () => {
    expect(READING_SLOTS.slice(0, 4)).toEqual(['first-reading', 'psalm', 'second-reading', 'gospel']);
    expect(READING_SLOTS).toContain('reading-1');
    expect(READING_SLOTS).toContain('reading-9');
    expect(READING_SLOTS).toContain('psalm-9');
    expect(READING_SLOTS.at(-1)).toBe('epistle');
    expect(READING_SLOTS).toHaveLength(4 + 9 + 9 + 1);
    expect(new Set(READING_SLOTS).size).toBe(READING_SLOTS.length);
  });
});

describe('helpers', () => {
  it('builds schema ids', () => {
    expect(schemaId('passage')).toBe(`${SCHEMA_ID_BASE}passage.schema.json`);
  });

  it('formats ajv errors one per line', () => {
    expect(ajv.validate({ type: 'object', required: ['a'], properties: { b: { type: 'string' } } }, { b: 1 })).toBe(
      false,
    );
    expect(formatErrors(ajv.errors)).toEqual(["/ must have required property 'a'", '/b must be string']);
    expect(formatErrors(null)).toEqual([]);
    expect(formatErrors(undefined)).toEqual([]);
  });

  it('creates strict instances that refuse unknown keywords', () => {
    expect(() => createAjv().compile({ type: 'string', colour: 'red' })).toThrow(/unknown keyword/);
  });
});
