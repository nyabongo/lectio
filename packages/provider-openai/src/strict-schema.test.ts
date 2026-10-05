import { CONTRACT_RESPONSE_SCHEMA } from '@lectio/providers/contracts';
import { describe, expect, it } from 'vitest';

import { isStrictCompatible, toStrictSchema } from './strict-schema.ts';

const closed = (properties: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
  ...extra,
});

describe('isStrictCompatible', () => {
  it('accepts a closed object whose properties are all required', () => {
    expect(
      isStrictCompatible(
        closed(
          {
            verdict: { type: 'string', enum: ['a', 'b'] },
            support: { type: 'number', minimum: 0, maximum: 1 },
            reasons: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^.+$' } },
            nested: closed({ ok: { type: 'boolean' } }),
            either: { anyOf: [{ type: 'string' }, { type: 'null' }] },
            ref: { $ref: '#/$defs/thing' },
          },
          { $defs: { thing: closed({ id: { type: 'string' } }) } },
        ),
      ),
    ).toBe(true);
  });

  it('rejects unsupported keywords (the contract schema uses minLength)', () => {
    expect(isStrictCompatible(CONTRACT_RESPONSE_SCHEMA)).toBe(false);
  });

  it('rejects a non-object root', () => {
    expect(isStrictCompatible({ type: 'string' })).toBe(false);
  });

  it('rejects open objects and optional properties', () => {
    expect(isStrictCompatible({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })).toBe(false);
    expect(
      isStrictCompatible({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } }),
    ).toBe(false);
    expect(
      isStrictCompatible({
        type: 'object',
        additionalProperties: false,
        required: ['b'],
        properties: { a: { type: 'string' } },
      }),
    ).toBe(false);
    expect(isStrictCompatible(closed({ inner: { properties: { a: { type: 'string' } } } }))).toBe(false);
  });

  it('accepts an empty closed object and rejects non-schema nodes', () => {
    expect(isStrictCompatible({ type: 'object', additionalProperties: false })).toBe(true);
    expect(isStrictCompatible(closed({ bad: true }))).toBe(false);
    expect(isStrictCompatible(closed({ list: { type: 'array', items: [{ type: 'string' }] } }))).toBe(false);
  });
});

describe('toStrictSchema', () => {
  it('drops constraint-only keywords at every schema position, keeping property names', () => {
    const schema = closed(
      {
        minLength: { type: 'string', minLength: 1, maxLength: 300 },
        list: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
        either: { anyOf: [{ type: 'string', maxLength: 3 }, { type: 'null' }] },
        ref: { $ref: '#/$defs/thing' },
      },
      {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $defs: { thing: closed({ id: { type: 'string', default: 'x' } }) },
      },
    );
    expect(toStrictSchema(schema)).toEqual(
      closed(
        {
          minLength: { type: 'string' },
          list: { type: 'array', items: { type: 'string' } },
          either: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          ref: { $ref: '#/$defs/thing' },
        },
        { $defs: { thing: closed({ id: { type: 'string' } }) } },
      ),
    );
    // The input is not modified.
    expect(schema.properties.minLength).toEqual({ type: 'string', minLength: 1, maxLength: 300 });
  });

  it('leaves non-schema values alone (and then rejects them)', () => {
    expect(toStrictSchema(closed({ a: { type: 'array', items: true } }))).toBeUndefined();
  });

  it('makes the contract schema strict', () => {
    expect(isStrictCompatible(toStrictSchema(CONTRACT_RESPONSE_SCHEMA) ?? {})).toBe(true);
  });

  it('returns undefined when the structure itself is not strict-compatible', () => {
    expect(toStrictSchema({ type: 'object', properties: { a: { type: 'string' } } })).toBeUndefined();
    expect(toStrictSchema(closed({ a: { oneOf: [{ type: 'string' }] } }))).toBeUndefined();
    expect(toStrictSchema(closed({ a: { type: 'string' } }, { properties: 'bad' }))).toBeUndefined();
  });
});
