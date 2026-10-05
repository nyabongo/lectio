import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { generateFromSchema, validateAgainstSchema } from './json-schema.ts';
import type { JsonSchema } from './llm.ts';

const passageLike: JsonSchema = {
  $defs: {
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['url', 'kind'],
      properties: {
        url: { type: 'string', format: 'uri' },
        kind: { type: 'string', enum: ['web', 'print'] },
        retrieved: { type: 'string', format: 'date' },
      },
    },
    node: { type: 'object', properties: { child: { $ref: '#/definitions/node' } } },
  },
  definitions: { node: { $ref: '#/$defs/node' } },
  type: 'object',
  required: ['summary', 'claims', 'confidence', 'flags'],
  properties: {
    summary: { type: 'string', minLength: 80, maxLength: 120 },
    claims: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        required: ['id', 'sources', 'level'],
        properties: {
          id: { type: 'string', maxLength: 6 },
          sources: { type: 'array', items: { $ref: '#/$defs/source' } },
          level: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
    confidence: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 },
    flags: { type: 'array', maxItems: 0, items: { type: 'string' } },
    createdAt: { type: 'string', format: 'date-time' },
    contact: { type: 'string', format: 'email' },
    note: { type: ['null', 'string'] },
    nothing: { type: 'null' },
    choice: { anyOf: [{ type: 'integer', minimum: 3 }, { type: 'string' }] },
    exactlyOne: { oneOf: [{ type: 'boolean' }, { type: 'string' }] },
    fixed: { const: 'v1' },
    combined: {
      allOf: [
        { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
        { required: ['b'], properties: { b: { type: 'number', minimum: 2 } } },
      ],
    },
    untyped: { properties: { inner: { type: 'boolean' } } },
    untypedList: { items: { type: 'integer', exclusiveMinimum: 4 } },
    plain: {},
    tree: { $ref: '#/$defs/node' },
  },
};

describe('generateFromSchema', () => {
  it('generates a value that validates against its schema', () => {
    const value = generateFromSchema(passageLike, 'seed');
    expect(validateAgainstSchema(passageLike, value)).toEqual([]);
    expect(value).toMatchObject({
      confidence: 0.99,
      flags: [],
      note: expect.any(String) as string,
      nothing: null,
      choice: 3,
      exactlyOne: false,
      fixed: 'v1',
      untyped: { inner: false },
      untypedList: [5],
    });
  });

  it('is deterministic per seed and varies strings across seeds', () => {
    expect(generateFromSchema(passageLike, 'a')).toEqual(generateFromSchema(passageLike, 'a'));
    expect(generateFromSchema(passageLike, 'a')).not.toEqual(generateFromSchema(passageLike, 'b'));
    expect(generateFromSchema({ type: 'string' })).toMatch(/^fake text [0-9a-f]{12}$/);
  });

  it('stops expanding recursive schemas', () => {
    let depth = 0;
    for (let node = generateFromSchema(passageLike) as Record<string, unknown>; ; depth++) {
      const next = (depth === 0 ? node['tree'] : node['child']) as Record<string, unknown> | undefined;
      if (next === undefined) break;
      node = next;
    }
    expect(depth).toBeGreaterThan(3);
    expect(depth).toBeLessThan(10);
  });

  it('stops expanding recursive arrays', () => {
    const nested = generateFromSchema({
      $defs: { l: { type: 'array', items: { $ref: '#/$defs/l' } } },
      $ref: '#/$defs/l',
    });
    expect(JSON.stringify(nested)).toBe(`${'['.repeat(9)}${']'.repeat(9)}`);
  });

  it('merges allOf parts into the outer schema', () => {
    const schema: JsonSchema = {
      type: 'object',
      required: ['outer'],
      properties: { outer: { type: 'integer' } },
      allOf: [{ properties: { inner: { type: 'boolean' } } }, { required: ['extra'] }],
    };
    expect(generateFromSchema(schema)).toEqual({ outer: 1, inner: false, extra: 'fake-extra' });
  });

  it('picks bounds sensibly for numbers', () => {
    expect(generateFromSchema({ type: 'number', minimum: 3 })).toBe(3);
    expect(generateFromSchema({ type: 'integer', exclusiveMinimum: 3 })).toBe(4);
    expect(generateFromSchema({ type: 'integer', exclusiveMaximum: 3 })).toBe(2);
    expect(generateFromSchema({ type: 'integer' })).toBe(1);
    expect(generateFromSchema({ type: 'number', maximum: 2.5 })).toBe(2.5);
    expect(generateFromSchema({ type: 'integer', maximum: 2.5 })).toBe(2);
  });

  it('fills required properties that are not declared', () => {
    expect(generateFromSchema({ type: 'object', required: ['x', 7], properties: { y: true } })).toEqual({
      y: null,
      x: 'fake-x',
    });
  });

  it('honours formats and length limits', () => {
    expect(generateFromSchema({ type: 'string', format: 'url' })).toMatch(/^https:\/\/example\.org\/fake\//);
    expect(generateFromSchema({ type: 'string', maxLength: 3 })).toBe('fak');
    expect(generateFromSchema({ type: 'array', items: { type: 'string' }, maxItems: 0 })).toEqual([]);
    expect(generateFromSchema({ type: 'array' })).toEqual([expect.any(String)]);
  });

  it('rejects unknown references', () => {
    expect(() => generateFromSchema({ $ref: 'https://example.org/schema' })).toThrow(/unsupported or unknown \$ref/);
    expect(() => generateFromSchema({ $ref: '#/$defs/missing', $defs: {} })).toThrow(/\$ref/);
    expect(() => generateFromSchema({ $ref: '#/$defs/x', $defs: 'nope' })).toThrow(/\$ref/);
  });

  it('validates whatever it generates for random flat schemas', () => {
    const leaf = fc.oneof(
      fc.record({ type: fc.constant('string'), minLength: fc.nat(30), maxLength: fc.integer({ min: 30, max: 60 }) }),
      fc.record({ type: fc.constant('integer'), minimum: fc.integer({ min: -5, max: 5 }) }),
      fc.record({ type: fc.constant('number'), maximum: fc.double({ min: -5, max: 5, noNaN: true }) }),
      fc.record({ enum: fc.array(fc.string(), { minLength: 1, maxLength: 3 }) }),
      fc.constant({ type: 'boolean' }),
    );
    fc.assert(
      fc.property(fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), leaf), fc.string(), (properties, seed) => {
        const schema = { type: 'object', required: Object.keys(properties), properties };
        expect(validateAgainstSchema(schema, generateFromSchema(schema, seed))).toEqual([]);
      }),
      { seed: 42, numRuns: 100 },
    );
  });
});

describe('validateAgainstSchema', () => {
  it('reports every kind of mismatch with a path', () => {
    const value = {
      summary: 'short',
      claims: [
        { id: 'toolong', sources: [{ url: 'not a url', kind: 'tv', extra: 1, retrieved: '2026-13-45' }], level: 9 },
      ],
      confidence: 1,
      flags: ['x'],
      createdAt: 'yesterday',
      contact: 'nobody',
      note: 3,
      choice: 1,
      exactlyOne: 2,
      fixed: 'v2',
      combined: { a: 'ok' },
      untypedList: [4],
    };
    expect(validateAgainstSchema(passageLike, value)).toEqual([
      '$.summary: shorter than 80',
      '$.claims: fewer than 2 items',
      '$.claims[0].id: longer than 6',
      '$.claims[0].sources[0].url: not a valid uri',
      '$.claims[0].sources[0].kind: must be one of ["web","print"]',
      '$.claims[0].sources[0]: unexpected property "extra"',
      '$.claims[0].sources[0].retrieved: not a valid date',
      '$.claims[0].level: violates maximum 5',
      '$.confidence: violates exclusiveMaximum 1',
      '$.flags: more than 0 items',
      '$.createdAt: not a valid date-time',
      '$.contact: not a valid email',
      '$.note: must be null or string, got integer',
      '$.choice: must match a schema in anyOf',
      '$.exactlyOne: must match exactly one schema in oneOf',
      '$.fixed: must equal "v1"',
      '$.combined: missing required property "b"',
      '$.untypedList[0]: violates exclusiveMinimum 4',
    ]);
  });

  it('reports missing properties, wrong types and long arrays', () => {
    expect(validateAgainstSchema(passageLike, [])).toEqual(['$: must be object, got array']);
    expect(validateAgainstSchema({ type: 'object', required: ['a'] }, {})).toEqual([
      '$: missing required property "a"',
    ]);
    expect(validateAgainstSchema({ type: 'array', maxItems: 1 }, [1, 2])).toEqual(['$: more than 1 items']);
    expect(validateAgainstSchema({ type: 'string', maxLength: 1 }, 'ab')).toEqual(['$: longer than 1']);
    expect(validateAgainstSchema({ type: 'number', minimum: 1 }, 0)).toEqual(['$: violates minimum 1']);
    expect(validateAgainstSchema({ type: 'integer' }, 1.5)).toEqual(['$: must be integer, got number']);
    expect(validateAgainstSchema({ type: 'number' }, 2)).toEqual([]);
    expect(validateAgainstSchema({ type: 'string', format: 'unknown' }, 'x')).toEqual([]);
    expect(validateAgainstSchema({ type: 'string', format: 'url' }, 'nope')).toEqual(['$: not a valid url']);
    expect(validateAgainstSchema({ oneOf: [{ type: 'string' }, { minLength: 1 }] }, 'ab')).toEqual([
      '$: must match exactly one schema in oneOf',
    ]);
  });
});
