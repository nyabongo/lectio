import { describe, expect, it } from 'vitest';

import { SchemaGenerationError, generateFromSchema, intersectSchemas, validateAgainstSchema } from './json-schema.ts';
import type { JsonSchema } from './llm.ts';

/** Generates and asserts the value validates (generateFromSchema also checks this itself). */
function valid(schema: JsonSchema, seed = ''): unknown {
  const value = generateFromSchema(schema, seed);
  expect(validateAgainstSchema(schema, value)).toEqual([]);
  return value;
}

describe('allOf intersects constraints', () => {
  it('tightens bounds instead of letting the last part win', () => {
    expect(valid({ allOf: [{ type: 'integer', minimum: 5 }, { minimum: 1 }] })).toBe(5);
    expect(
      valid({
        allOf: [
          { type: 'number', maximum: 2 },
          { maximum: 9, exclusiveMaximum: 3 },
        ],
      }),
    ).toBe(2);
    expect(
      valid({
        allOf: [
          { type: 'string', maxLength: 9, minLength: 1 },
          { maxLength: 4, minLength: 2 },
        ],
      }),
    ).toBe('fake');
  });

  it('intersects types, enums, required, properties, items and not', () => {
    expect(intersectSchemas({ type: ['number', 'string'] }, { type: 'integer' })).toEqual({ type: ['integer'] });
    expect(intersectSchemas({ type: 'integer' }, { type: ['number'] })).toEqual({ type: ['integer'] });
    expect(intersectSchemas({ enum: ['a', 'b', 'c'] }, { enum: ['c', 'b'] })).toEqual({ enum: ['b', 'c'] });
    expect(intersectSchemas({ required: ['a'] }, { required: ['a', 'b'] })).toEqual({ required: ['a', 'b'] });
    expect(
      intersectSchemas({ properties: { a: { type: 'string' } } }, { properties: { a: { maxLength: 2 }, b: {} } }),
    ).toEqual({ properties: { a: { allOf: [{ type: 'string' }, { maxLength: 2 }] }, b: {} } });
    expect(intersectSchemas({ items: { type: 'string' } }, { items: { minLength: 1 } })).toEqual({
      items: { allOf: [{ type: 'string' }, { minLength: 1 }] },
    });
    expect(intersectSchemas({ not: { const: 1 } }, { not: { const: 2 } })).toEqual({
      not: { anyOf: [{ const: 1 }, { const: 2 }] },
    });
    expect(intersectSchemas({ uniqueItems: false }, { uniqueItems: true })).toEqual({ uniqueItems: true });
    expect(intersectSchemas({ format: 'date' }, { format: 'uri' })).toEqual({ format: 'date' });
    expect(
      valid({
        type: 'object',
        allOf: [
          { required: ['a'], properties: { a: { type: 'integer', minimum: 2 } } },
          { properties: { a: { maximum: 3 } }, required: ['b'] },
        ],
      }),
    ).toEqual({ a: 3, b: 'fake-b' });
  });
});

describe('oneOf and anyOf', () => {
  it('produces a value that matches exactly one oneOf branch', () => {
    const number = valid({ oneOf: [{ type: 'number' }, { type: 'integer' }] });
    expect(Number.isInteger(number)).toBe(false);
    expect(valid({ oneOf: [{ type: 'integer' }, { type: 'number', minimum: 0 }] })).toBe(0.5);
    expect(valid({ type: 'string', oneOf: [{ enum: ['x', 'y'] }, { const: 'x' }] })).toBe('y');
  });

  it('falls through anyOf branches that cannot be generated', () => {
    expect(valid({ anyOf: [false, { type: 'boolean' }] })).toBe(false);
    expect(() => generateFromSchema({ oneOf: [{ const: 1 }, { const: 1 }] })).toThrow(SchemaGenerationError);
  });
});

describe('number bounds', () => {
  it.each([
    [{ type: 'integer', minimum: 2.5 }, 3],
    [{ type: 'integer', maximum: 2.5 }, 2],
    [{ type: 'integer', exclusiveMinimum: 2.5 }, 3],
    [{ type: 'integer', exclusiveMinimum: 3 }, 4],
    [{ type: 'integer', exclusiveMaximum: 2.5 }, 2],
    [{ type: 'integer', exclusiveMaximum: 3 }, 2],
    [{ type: 'number', exclusiveMinimum: 0.5 }, 0.51],
    [{ type: 'number', exclusiveMaximum: 1 }, 0.99],
    [{ type: 'integer', minimum: 1, maximum: 9, multipleOf: 4 }, 8],
    [{ type: 'integer', minimum: 2, maximum: 3, multipleOf: 5 }, undefined],
    [{ type: 'number', minimum: 7, multipleOf: 3 }, 9],
    [{ type: 'integer', minimum: 1, maximum: 3, not: { enum: [1, 3] } }, 2],
    [{ type: 'number', multipleOf: 0.25, not: { enum: [0, 1] } }, 0.25],
    [{ maximum: 4 }, 4],
    [{ type: 'boolean', not: { const: false } }, true],
  ])('generates a valid value for %j', (schema, expected) => {
    if (expected === undefined) {
      expect(() => generateFromSchema(schema)).toThrow(/cannot generate \$/);
    } else {
      expect(valid(schema)).toBe(expected);
    }
  });
});

describe('formats', () => {
  it('rejects rollover dates and malformed timestamps', () => {
    const date: JsonSchema = { type: 'string', format: 'date' };
    const dateTime: JsonSchema = { type: 'string', format: 'date-time' };
    expect(validateAgainstSchema(date, '2026-02-28')).toEqual([]);
    expect(validateAgainstSchema(date, '2024-02-29')).toEqual([]);
    expect(validateAgainstSchema(date, '2026-02-30')).toEqual(['$: not a valid date']);
    expect(validateAgainstSchema(date, '2026-13-01')).toEqual(['$: not a valid date']);
    expect(validateAgainstSchema(dateTime, '2026-02-28T23:59:60+03:00')).toEqual([]);
    expect(validateAgainstSchema(dateTime, '2026-02-30T00:00:00Z')).toEqual(['$: not a valid date-time']);
    expect(validateAgainstSchema(dateTime, '2026-02-28')).toEqual(['$: not a valid date-time']);
    expect(validateAgainstSchema(dateTime, '2026-02-28T00:00:00')).toEqual(['$: not a valid date-time']);
  });
});

describe('patterns', () => {
  it('validates patterns with unicode semantics', () => {
    const slug: JsonSchema = { type: 'string', pattern: '^[a-z]+(-[a-z]+)*$' };
    expect(validateAgainstSchema(slug, 'evil-eye')).toEqual([]);
    expect(validateAgainstSchema(slug, 'Evil eye')).toEqual(['$: does not match /^[a-z]+(-[a-z]+)*$/']);
    expect(validateAgainstSchema({ type: 'string', pattern: '^.$' }, '😀')).toEqual([]);
  });

  it('keeps readable strings that already match and generates the rest from the pattern', () => {
    expect(valid({ type: 'string', pattern: '^fake' })).toMatch(/^fake text [0-9a-f]{12}$/);
    expect(valid({ type: 'string', pattern: '^c[1-9][0-9]*$' }, 'seed')).toMatch(/^c[1-9][0-9]$/);
    expect(valid({ type: 'string', format: 'uri', pattern: '^https://' })).toMatch(/^https:\/\/example\.org\//);
  });

  it('prefers examples and defaults that validate', () => {
    expect(valid({ type: 'string', pattern: '^[A-Z]{3}$', examples: ['no', 'ABC'], default: 'XYZ' })).toBe('ABC');
    expect(valid({ type: 'string', pattern: '^[A-Z]{3}$', default: 'XYZ' })).toBe('XYZ');
  });

  it('throws a clear error when a pattern cannot be satisfied', () => {
    const lookahead: JsonSchema = {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', pattern: '^(?=x)x$' } },
    };
    expect(() => generateFromSchema(lookahead)).toThrow(SchemaGenerationError);
    expect(() => generateFromSchema(lookahead)).toThrow(
      /cannot generate \$\.id: .*lookarounds.*script this output instead/,
    );
    expect(() => generateFromSchema({ type: 'string', pattern: '^a{10}$', maxLength: 3 })).toThrow(
      /no candidate matches/,
    );
    const error = (() => {
      try {
        generateFromSchema({ type: 'string', pattern: '^a{10}$', maxLength: 3 });
      } catch (e) {
        return e as SchemaGenerationError;
      }
      return undefined;
    })();
    expect(error?.path).toBe('$');
  });

  it('drops an optional field it cannot generate rather than failing the object', () => {
    expect(valid({ type: 'object', properties: { id: { type: 'string', pattern: '^(?=x)x$' } } })).toEqual({});
  });
});

describe('conditionals and object keywords', () => {
  const review: JsonSchema = {
    type: 'object',
    required: ['status'],
    properties: { status: { enum: ['pending', 'approved'] }, method: { enum: ['human', 'auto'] } },
    allOf: [
      {
        if: { properties: { status: { const: 'approved' } } },
        then: { required: ['method'] },
        else: { not: { required: ['method'] } },
      },
    ],
  };

  it('applies if/then/else while generating', () => {
    expect(valid(review)).toEqual({ status: 'pending' });
    expect(
      valid({ ...review, properties: { ...(review['properties'] as object), status: { const: 'approved' } } }),
    ).toEqual({
      status: 'approved',
      method: 'human',
    });
    expect(valid({ if: { type: 'string' }, then: { minLength: 30 } })).toHaveLength(30);
  });

  it('validates if/then/else, not, propertyNames, dependentRequired and property counts', () => {
    expect(validateAgainstSchema(review, { status: 'approved' })).toEqual(['$: missing required property "method"']);
    expect(validateAgainstSchema(review, { status: 'pending', method: 'auto' })).toEqual(['$: must not match "not"']);
    const object: JsonSchema = {
      type: 'object',
      propertyNames: { not: { enum: ['text'] } },
      dependentRequired: { excerptLang: ['excerpt'], odd: 'not-a-list' },
      minProperties: 1,
      maxProperties: 2,
      patternProperties: { '^x-': { type: 'integer' } },
      additionalProperties: { type: 'string' },
    };
    expect(validateAgainstSchema(object, { excerptLang: 'en', excerpt: 'e' })).toEqual([]);
    expect(validateAgainstSchema(object, { text: 'reading', excerptLang: 'en', 'x-n': 'one' })).toEqual([
      '$: more than 2 properties',
      '$: "excerptLang" requires "excerpt"',
      '$: property name "text" is not allowed',
      '$.x-n: must be integer, got string',
    ]);
    expect(validateAgainstSchema(object, {})).toEqual(['$: fewer than 1 properties']);
    expect(validateAgainstSchema(object, { a: 1, odd: 'x' })).toEqual(['$.a: must be string, got integer']);
    expect(validateAgainstSchema({ properties: { a: false } }, { a: 1 })).toEqual(['$.a: no value is allowed here']);
  });

  it('generates undeclared required properties from additionalProperties', () => {
    expect(valid({ type: 'object', required: ['n'], additionalProperties: { type: 'integer', maximum: 7 } })).toEqual({
      n: 7,
    });
    expect(() => generateFromSchema({ required: ['a'], properties: { a: false } })).toThrow(/the schema is false/);
  });

  it('throws when conditionals never settle, and rethrows unexpected errors', () => {
    const flipFlop: JsonSchema = {
      type: 'boolean',
      if: { const: false },
      then: { const: true },
      else: { const: false },
    };
    expect(() => generateFromSchema(flipFlop)).toThrow(/cannot generate \$: \$: must equal (true|false)/);
    expect(() => generateFromSchema({ type: 'object', properties: { a: { $ref: '#/$defs/missing' } } })).toThrow(
      'unsupported or unknown $ref: #/$defs/missing',
    );
  });

  it('reports unsupported keywords instead of ignoring them', () => {
    expect(validateAgainstSchema({ type: 'object', unevaluatedProperties: false }, {})).toEqual([
      '$: unsupported keyword "unevaluatedProperties"',
    ]);
  });
});

describe('array keywords', () => {
  it('validates and generates uniqueItems and contains', () => {
    const schema: JsonSchema = {
      type: 'array',
      minItems: 2,
      uniqueItems: true,
      items: { type: 'string', enum: ['a', 'b'] },
    };
    expect(validateAgainstSchema(schema, ['a', 'a'])).toEqual(['$: items must be unique']);
    expect(() => generateFromSchema(schema)).toThrow(/items must be unique/);
    const hasError: JsonSchema = {
      type: 'array',
      items: { type: 'object', required: ['severity'], properties: { severity: { enum: ['info', 'error'] } } },
      contains: { properties: { severity: { const: 'error' } } },
    };
    expect(valid(hasError)).toEqual([{ severity: 'error' }]);
    expect(validateAgainstSchema(hasError, [{ severity: 'info' }])).toEqual(['$: must contain a matching item']);
    expect(valid({ contains: { const: 3 } })).toEqual([3]);
    expect(valid({ items: true, contains: { const: 3 }, minItems: 2 })).toEqual([3, null]);
    expect(valid({ type: 'array', items: { type: 'integer' }, not: { minItems: 1 } })).toEqual([]);
  });
});
