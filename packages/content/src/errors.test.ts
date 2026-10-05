import { describe, expect, it } from 'vitest';

import type { ErrorObject } from '@lectio/schema/common';

import { ContentError, formatIssue, issuesFromAjv, pointerSegment } from './errors.ts';

const ajvError = (overrides: Partial<ErrorObject>): ErrorObject => ({
  keyword: 'type',
  instancePath: '',
  schemaPath: '#',
  params: {},
  message: 'must be object',
  ...overrides,
});

describe('ContentError', () => {
  it('carries the file, the first pointer and every issue', () => {
    const error = new ContentError('passages/MT.20.1-16.json', [
      { pointer: '/review', message: 'is required' },
      { pointer: '', message: 'second problem' },
    ]);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ContentError');
    expect(error.file).toBe('passages/MT.20.1-16.json');
    expect(error.pointer).toBe('/review');
    expect(error.issues).toHaveLength(2);
    expect(error.message).toBe(
      'passages/MT.20.1-16.json#/review: is required\npassages/MT.20.1-16.json: second problem',
    );
  });
});

describe('formatIssue', () => {
  it('omits the pointer for the whole file', () => {
    expect(formatIssue('a.json', { pointer: '', message: 'bad' })).toBe('a.json: bad');
    expect(formatIssue('a.json', { pointer: '/x/0', message: 'bad' })).toBe('a.json#/x/0: bad');
  });
});

describe('pointerSegment', () => {
  it('escapes ~ and / per RFC 6901', () => {
    expect(pointerSegment('a/b~c')).toBe('a~1b~0c');
  });
});

describe('issuesFromAjv', () => {
  it('reports the whole file when there is nothing to say', () => {
    expect(issuesFromAjv(null)).toEqual([{ pointer: '', message: 'does not match the schema' }]);
    expect(issuesFromAjv([ajvError({ keyword: 'if' })])).toEqual([
      { pointer: '', message: 'does not match the schema' },
    ]);
  });

  it('points at the field for required, additionalProperties and propertyNames', () => {
    expect(
      issuesFromAjv([
        ajvError({ keyword: 'required', instancePath: '/review', params: { missingProperty: 'status' } }),
        ajvError({ keyword: 'additionalProperties', params: { additionalProperty: 'a/b' } }),
        ajvError({ keyword: 'not', propertyName: 'text', params: {} }),
        ajvError({ keyword: 'propertyNames', params: { propertyName: 'text' } }),
      ]),
    ).toEqual([
      { pointer: '/review/status', message: 'is required' },
      { pointer: '/a~1b', message: 'unknown field' },
      { pointer: '/text', message: 'field name is not allowed' },
    ]);
  });

  it('lists enum values and keeps other messages, without duplicates', () => {
    const enumError = ajvError({ keyword: 'enum', instancePath: '/colour', params: { allowedValues: ['white'] } });
    expect(issuesFromAjv([enumError, enumError, ajvError({ instancePath: '/days', message: undefined })])).toEqual([
      { pointer: '/colour', message: 'must be one of "white"' },
      { pointer: '/days', message: 'undefined' },
    ]);
  });
});
