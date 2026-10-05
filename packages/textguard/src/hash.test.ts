import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { assertShingleSize, KEY_BITS, mix64, shingleKeys, wordHash } from './hash.ts';

describe('wordHash', () => {
  it('is FNV-1a 64', () => {
    expect(wordHash('')).toBe(0xcbf29ce484222325n);
    expect(wordHash('a')).toBe(0xaf63dc4c8601ec8cn);
    expect(wordHash('foobar')).toBe(0x85944171f73967e8n);
  });
});

describe('mix64', () => {
  it('maps 0 to 0 and spreads nearby inputs', () => {
    expect(mix64(0n)).toBe(0n);
    expect(mix64(1n)).not.toBe(mix64(2n));
    expect(mix64(1n)).toBeLessThan(2n ** 64n);
  });
});

describe('assertShingleSize', () => {
  it.each([1, 65, 2.5, Number.NaN])('rejects %s', (n) => {
    expect(() => assertShingleSize(n)).toThrow(RangeError);
  });

  it.each([2, 8, 64])('accepts %s', (n) => {
    expect(() => assertShingleSize(n)).not.toThrow();
  });
});

describe('shingleKeys', () => {
  const words = ['one', 'two', 'three', 'four', 'five'].map(wordHash);

  it('gives one key per window and none for short input', () => {
    expect(shingleKeys(words, 3)).toHaveLength(3);
    expect(shingleKeys(words, 5)).toHaveLength(1);
    expect(shingleKeys(words, 6)).toEqual([]);
  });

  it('gives integer keys below 2^40', () => {
    for (const key of shingleKeys(words, 2)) {
      expect(Number.isSafeInteger(key) && key >= 0 && key < 2 ** KEY_BITS).toBe(true);
    }
  });

  it('depends on word order', () => {
    const [a, b] = shingleKeys([words[0]!, words[1]!, words[0]!], 2);
    expect(a).not.toBe(b);
  });

  it('rolls: every window equals the hash of that window computed alone', () => {
    fc.assert(
      fc.property(
        fc.array(fc.bigInt({ min: 0n, max: 2n ** 64n - 1n }), { minLength: 2, maxLength: 30 }),
        fc.integer({ min: 2, max: 8 }),
        (hashes, n) => {
          const rolled = shingleKeys(hashes, n);
          rolled.forEach((key, i) => {
            expect(shingleKeys(hashes.slice(i, i + n), n)).toEqual([key]);
          });
        },
      ),
    );
  });
});
