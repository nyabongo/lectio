import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DEFAULT_SHINGLE_SIZE, KEY_BITS, shingleKeys, wordHash } from './hash.ts';
import {
  buildIndex,
  collectShingleKeys,
  encodeIndex,
  INDEX_HEADER_BYTES,
  loadIndex,
  riceParameter,
} from './index-file.ts';
import { NORMALISER_VERSION, tokenise } from './normalise.ts';

const KEY_LIMIT = 2 ** KEY_BITS;
const SOURCE = 'the lighthouse keeper rowed out at dawn to count the gulls nesting on the far rocks';
const keysOf = (text: string, n: number) =>
  shingleKeys(
    tokenise(text).map((t) => wordHash(t.word)),
    n,
  );

describe('collectShingleKeys', () => {
  it('returns sorted unique keys and never joins two texts', () => {
    const keys = collectShingleKeys(['a b c d', 'a b c d', 'e f'], 3);
    expect([...keys]).toEqual([...new Set(keysOf('a b c d', 3))].sort((x, y) => x - y));
  });

  it('grows past its initial buffer', () => {
    const words = Array.from({ length: 3000 }, (_, i) => `w${i}`).join(' ');
    expect(collectShingleKeys([words], 2)).toHaveLength(2999);
  });

  it('defaults to 8-word shingles', () => {
    expect(collectShingleKeys([SOURCE])).toHaveLength(tokenise(SOURCE).length - DEFAULT_SHINGLE_SIZE + 1);
  });
});

const header = (count: number, k: number, keyBits = 40): Uint8Array => {
  const bytes = encodeIndex([], 8).slice(0, INDEX_HEADER_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, count, true);
  view.setUint8(16, keyBits);
  view.setUint8(17, k);
  return bytes;
};
/** A hand-made file: header plus a body given as a bit string (zero-padded to whole bytes). */
const file = (count: number, k: number, bits: string): Uint8Array => {
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
  const body = Array.from({ length: padded.length / 8 }, (_, i) => parseInt(padded.slice(i * 8, i * 8 + 8), 2));
  return Uint8Array.from([...header(count, k), ...body]);
};

describe('riceParameter', () => {
  it('is log2 of about ln 2 times the mean gap', () => {
    expect(riceParameter(0)).toBe(0);
    expect(riceParameter(1)).toBe(39);
    expect(riceParameter(1_700_000)).toBe(18);
    expect(riceParameter(2 ** 41)).toBe(0);
  });
});

describe('encodeIndex / loadIndex', () => {
  it('round-trips arbitrary key sets', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 0, max: KEY_LIMIT - 1 }), { maxLength: 60 }), (values) => {
        const keys = Float64Array.from(values).sort();
        const index = loadIndex(encodeIndex(keys, 5));
        expect(index.size).toBe(keys.length);
        expect(index.shingleSize).toBe(5);
        for (const key of keys) expect(index.has(key)).toBe(true);
        expect(index.has(12345)).toBe(keys.includes(12345));
      }),
    );
  });

  it('round-trips dense keys and the extremes of the key space', () => {
    const dense = Array.from({ length: 5000 }, (_, i) => i * 3);
    const index = loadIndex(encodeIndex(dense, 8));
    expect(dense.every((k) => index.has(k))).toBe(true);
    expect(index.has(1)).toBe(false);
    const ends = loadIndex(encodeIndex([0, KEY_LIMIT - 1], 8));
    expect(ends.has(0) && ends.has(KEY_LIMIT - 1)).toBe(true);
  });

  it('writes the header', () => {
    const bytes = encodeIndex([1, 99], 8);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('LSHI');
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(4, true)).toBe(2);
    expect(view.getUint16(6, true)).toBe(8);
    expect(view.getUint32(8, true)).toBe(2);
    expect(view.getUint32(12, true)).toBe(NORMALISER_VERSION);
    expect(view.getUint8(16)).toBe(40);
    expect(view.getUint8(17)).toBe(riceParameter(2));
    expect(loadIndex(bytes).normaliserVersion).toBe(NORMALISER_VERSION);
  });

  it('spends about 21 bits per key at the size of the real index', () => {
    const keys = Array.from({ length: 20_000 }, (_, i) => Math.floor((i + Math.random()) * (KEY_LIMIT / 20_000)));
    const bits = (encodeIndex(keys, 8).length - INDEX_HEADER_BYTES) * 8;
    expect(bits / keys.length).toBeLessThan(40 - Math.log2(20_000) + 2);
  });

  it('answers misses on both sides of every key', () => {
    const index = loadIndex(encodeIndex([10, 20, 30], 2));
    expect([5, 15, 25, 35].map((k) => index.has(k))).toEqual([false, false, false, false]);
    expect(loadIndex(encodeIndex([], 2)).has(1)).toBe(false);
  });

  it('refuses unsorted, duplicate or out-of-range keys', () => {
    expect(() => encodeIndex([2, 1], 8)).toThrow('ascending and unique');
    expect(() => encodeIndex([2, 2], 8)).toThrow('ascending and unique');
    expect(() => encodeIndex([KEY_LIMIT], 8)).toThrow('key out of range');
    expect(() => encodeIndex([-1], 8)).toThrow('key out of range');
    expect(() => encodeIndex([1.5], 8)).toThrow('key out of range');
  });

  it('rejects malformed files', () => {
    const good = encodeIndex([1, 300], 8);
    const mutate = (fn: (view: DataView) => void): Uint8Array => {
      const copy = good.slice();
      fn(new DataView(copy.buffer));
      return copy;
    };
    expect(() => loadIndex(good.subarray(0, 10))).toThrow('shorter than its header');
    expect(() => loadIndex(mutate((v) => v.setUint8(0, 0x58)))).toThrow('bad magic');
    expect(() => loadIndex(mutate((v) => v.setUint16(4, 1, true)))).toThrow('unsupported format version 1');
    expect(() => loadIndex(mutate((v) => v.setUint16(6, 1, true)))).toThrow(RangeError);
    expect(() => loadIndex(header(0, 0, 64))).toThrow('unsupported key size 64 bits');
    expect(() => loadIndex(header(0, 41))).toThrow('bad Rice parameter 41');
    expect(() => loadIndex(file(9, 0, '0'))).toThrow('truncated body');
    expect(() => loadIndex(file(1, 0, '0'.repeat(16)))).toThrow('trailing bytes');
    expect(() => loadIndex(file(1, 0, '01'))).toThrow('non-zero padding');
    expect(() => loadIndex(file(1, 40, '10'))).toThrow('key overflows 40 bits');
    expect(() => loadIndex(file(2, 40, `0${'1'.repeat(40)}0${'0'.repeat(40)}`))).toThrow('key overflows 40 bits');
    expect(loadIndex(file(1, 40, `0${'1'.repeat(40)}`)).has(KEY_LIMIT - 1)).toBe(true);
  });

  it('decodes in-place views of a larger buffer', () => {
    const bytes = encodeIndex([7], 3);
    const padded = new Uint8Array(bytes.length + 4);
    padded.set(bytes, 4);
    expect(loadIndex(padded.subarray(4)).has(7)).toBe(true);
  });
});

describe('buildIndex', () => {
  it('indexes every shingle of every text', () => {
    const index = loadIndex(buildIndex([SOURCE], { shingleSize: 4 }));
    expect(index.shingleSize).toBe(4);
    for (const key of keysOf(SOURCE, 4)) expect(index.has(key)).toBe(true);
    expect(index.has(keysOf('the gulls nesting near', 4)[0]!)).toBe(false);
  });

  it('uses 8-word shingles by default', () => {
    expect(loadIndex(buildIndex([SOURCE])).shingleSize).toBe(8);
  });

  it('never stores the words', () => {
    const bytes = buildIndex([SOURCE.repeat(3)], { shingleSize: 2 });
    expect(Buffer.from(bytes).toString('latin1')).not.toMatch(/lighthouse|keeper|gulls/);
  });
});
