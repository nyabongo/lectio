import { CONTRACT_RESPONSE_SCHEMA } from '@lectio/providers/contracts';
import { describe, expect, it } from 'vitest';

import { toStructuredOutputSchema } from './schema.ts';

describe('toStructuredOutputSchema', () => {
  it('moves unsupported constraints into descriptions and closes objects', () => {
    expect(toStructuredOutputSchema(CONTRACT_RESPONSE_SCHEMA)).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'support', 'sensitive', 'reasons'],
      properties: {
        verdict: { type: 'string', enum: ['supported', 'refuted', 'unclear'] },
        support: { type: 'number', description: '{minimum: 0, maximum: 1}' },
        sensitive: { type: 'boolean' },
        reasons: {
          type: 'array',
          minItems: 1,
          description: '{maxItems: 3}',
          items: { type: 'string', description: '{minLength: 1}' },
        },
      },
    });
  });

  it('keeps descriptions, supported formats, refs and definitions', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'x',
      title: 'Thing',
      description: 'A thing.',
      type: ['object', 'null'],
      properties: {
        when: { type: 'string', format: 'date', default: '2026-01-01' },
        link: { type: 'string', format: 'url', pattern: '^https://' },
        kind: { $ref: '#/definitions/kind' },
        other: { $ref: '#/$defs/other' },
        tags: { type: 'array', minItems: 2, items: { const: 'a' } },
        choice: { oneOf: [{ type: 'string' }, { type: 'integer', multipleOf: 2 }], anyOf: [{ type: 'null' }] },
        both: { allOf: [{ type: 'object', properties: {} }] },
        map: { type: 'object', additionalProperties: { type: 'string' } },
        positional: { type: 'array', items: [{ type: 'string' }] },
      },
      definitions: { kind: { enum: ['a', 'b'], examples: ['a'] } },
      $defs: { other: { type: 'string', maxLength: 4 } },
      if: { required: ['when'] },
      then: { required: ['link'] },
    };
    expect(toStructuredOutputSchema(schema)).toEqual({
      title: 'Thing',
      type: ['object', 'null'],
      properties: {
        when: { type: 'string', format: 'date' },
        link: { type: 'string', description: '{format: "url", pattern: "^https://"}' },
        kind: { $ref: '#/$defs/kind' },
        other: { $ref: '#/$defs/other' },
        tags: { type: 'array', items: { const: 'a' }, description: '{minItems: 2}' },
        choice: {
          anyOf: [{ type: 'string' }, { type: 'integer', description: '{multipleOf: 2}' }, { type: 'null' }],
        },
        both: { allOf: [{ type: 'object', properties: {}, additionalProperties: false }] },
        map: { type: 'object', additionalProperties: false, description: '{additionalProperties: {"type":"string"}}' },
        positional: { type: 'array', description: '{items: [{"type":"string"}]}' },
      },
      $defs: { kind: { enum: ['a', 'b'] }, other: { type: 'string', description: '{maxLength: 4}' } },
      additionalProperties: false,
      description: 'A thing.\n\n{if: {"required":["when"]}, then: {"required":["link"]}}',
    });
  });

  it('treats an untyped schema with properties as an object and leaves the input alone', () => {
    const schema = { properties: { a: { type: 'string' } }, additionalProperties: false, $ref: 5 };
    const copy = structuredClone(schema);
    expect(toStructuredOutputSchema(schema)).toEqual({
      properties: { a: { type: 'string' } },
      additionalProperties: false,
      $ref: 5,
    });
    expect(schema).toEqual(copy);
    expect(toStructuredOutputSchema({ type: 'object', properties: [] })).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
  });
});
