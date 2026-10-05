import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { isFilenameSafe, refArbitrary, stripParts } from './fixtures/arbitraries.ts';
import { KEY_PATTERN, formatRef, fromKey, parseRef, toKey } from './index.ts';

describe('properties', () => {
  it('fromKey(toKey(ref)) round-trips (sub-verse letters dropped)', () => {
    fc.assert(
      fc.property(refArbitrary, (ref) => {
        expect(fromKey(toKey(ref))).toEqual(stripParts(ref));
      }),
      { numRuns: 500 },
    );
  });

  it('toKey(fromKey(key)) round-trips', () => {
    fc.assert(
      fc.property(refArbitrary, (ref) => {
        const key = toKey(ref);
        expect(toKey(fromKey(key))).toBe(key);
      }),
    );
  });

  it('keys are filename-safe', () => {
    fc.assert(
      fc.property(refArbitrary, (ref) => {
        const key = toKey(ref);
        expect(key).toMatch(KEY_PATTERN);
        expect(isFilenameSafe(key)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it.each(['short', 'long'] as const)('parseRef(formatRef(ref, %s)) round-trips', (style) => {
    fc.assert(
      fc.property(refArbitrary, (ref) => {
        expect(parseRef(formatRef(ref, { style }))).toEqual(ref);
      }),
      { numRuns: 500 },
    );
  });

  it('spoken formatting never throws for a well-formed ref', () => {
    fc.assert(
      fc.property(refArbitrary, (ref) => {
        expect(formatRef(ref, { style: 'spoken' }).length).toBeGreaterThan(0);
      }),
    );
  });
});
