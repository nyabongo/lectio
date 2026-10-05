/**
 * The shingle index file: a sorted set of {@link KEY_BITS}-bit shingle keys and
 * nothing else, stored as a Golomb-Rice-coded set.
 *
 * Layout (little-endian):
 *
 * | offset | size | field                                       |
 * | ------ | ---- | ------------------------------------------- |
 * | 0      | 4    | magic `LSHI`                                |
 * | 4      | 2    | format version (2)                          |
 * | 6      | 2    | shingle size `n`                            |
 * | 8      | 4    | number of keys                              |
 * | 12     | 4    | normaliser version                          |
 * | 16     | 1    | key bits (40)                               |
 * | 17     | 1    | Rice parameter `k`                          |
 * | 18     | 2    | reserved (0)                                |
 * | 20     | …    | Rice-coded gaps, MSB first, zero-padded     |
 *
 * The keys are sorted; the first is coded as is and each later one as
 * `key - previous - 1`. A gap `g` is written as `floor(g / 2^k)` one-bits, a
 * zero-bit, then the low `k` bits of `g`. That costs about `log2(2^40 / N) + 1.5`
 * bits per key (~21 bits for 1.7M keys) instead of 64.
 */
import { assertShingleSize, DEFAULT_SHINGLE_SIZE, KEY_BITS, shingleKeys, wordHash } from './hash.ts';
import { NORMALISER_VERSION, tokenise } from './normalise.ts';

export const INDEX_MAGIC = 'LSHI';
export const INDEX_FORMAT_VERSION = 2;
export const INDEX_HEADER_BYTES = 20;

const KEY_LIMIT = 2 ** KEY_BITS;

/** A loaded index: membership tests over shingle keys. */
export interface ShingleIndex {
  readonly shingleSize: number;
  readonly normaliserVersion: number;
  /** Number of distinct keys. */
  readonly size: number;
  has(key: number): boolean;
}

export interface BuildIndexOptions {
  /** Words per shingle; default {@link DEFAULT_SHINGLE_SIZE}. */
  readonly shingleSize?: number;
}

/** Hashes words with a per-build cache (a Bible has ~30k distinct words but ~900k tokens). */
function cachedWordHashes(cache: Map<string, bigint>, text: string): bigint[] {
  return tokenise(text).map(({ word }) => {
    let hash = cache.get(word);
    if (hash === undefined) {
      hash = wordHash(word);
      cache.set(word, hash);
    }
    return hash;
  });
}

/** Every distinct shingle key in `texts`, ascending. Shingles never span two texts. */
export function collectShingleKeys(texts: Iterable<string>, shingleSize = DEFAULT_SHINGLE_SIZE): Float64Array {
  assertShingleSize(shingleSize);
  const cache = new Map<string, bigint>();
  let keys = new Float64Array(1024);
  let length = 0;
  for (const text of texts) {
    for (const key of shingleKeys(cachedWordHashes(cache, text), shingleSize)) {
      if (length === keys.length) {
        const grown = new Float64Array(keys.length * 2);
        grown.set(keys);
        keys = grown;
      }
      keys[length++] = key;
    }
  }
  const sorted = keys.subarray(0, length).sort();
  let unique = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (unique === 0 || sorted[i] !== sorted[unique - 1]) sorted[unique++] = sorted[i] as number;
  }
  return sorted.slice(0, unique);
}

/** The Rice parameter for `count` keys spread over the key space: log2 of about ln 2 × the mean gap. */
export function riceParameter(count: number): number {
  if (count === 0) return 0;
  return Math.max(0, Math.min(KEY_BITS, Math.floor(Math.log2((KEY_LIMIT / count) * Math.LN2))));
}

class BitWriter {
  readonly bytes: number[] = [];
  private current = 0;
  private used = 0;

  bit(value: number): void {
    this.current = (this.current << 1) | value;
    if (++this.used === 8) {
      this.bytes.push(this.current);
      this.current = 0;
      this.used = 0;
    }
  }

  /** Writes the low `width` bits of a non-negative integer below 2^53, most significant first. */
  bits(value: number, width: number): void {
    for (let i = width - 1; i >= 0; i--) this.bit(Math.floor(value / 2 ** i) % 2);
  }

  finish(): number[] {
    if (this.used > 0) this.bytes.push(this.current << (8 - this.used));
    return this.bytes;
  }
}

/** Serialises ascending, unique {@link KEY_BITS}-bit keys into the index file format. */
export function encodeIndex(keys: ArrayLike<number>, shingleSize: number): Uint8Array {
  assertShingleSize(shingleSize);
  const k = riceParameter(keys.length);
  const divisor = 2 ** k;
  const writer = new BitWriter();
  let previous = -1;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as number;
    if (!Number.isInteger(key) || key < 0 || key >= KEY_LIMIT) throw new RangeError(`key out of range: ${key}`);
    if (key <= previous) throw new Error('index keys must be ascending and unique');
    const gap = key - previous - 1;
    previous = key;
    for (let q = Math.floor(gap / divisor); q > 0; q--) writer.bit(1);
    writer.bit(0);
    writer.bits(gap % divisor, k);
  }
  const body = writer.finish();
  const bytes = new Uint8Array(INDEX_HEADER_BYTES + body.length);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(INDEX_MAGIC), 0);
  view.setUint16(4, INDEX_FORMAT_VERSION, true);
  view.setUint16(6, shingleSize, true);
  view.setUint32(8, keys.length, true);
  view.setUint32(12, NORMALISER_VERSION, true);
  view.setUint8(16, KEY_BITS);
  view.setUint8(17, k);
  bytes.set(body, INDEX_HEADER_BYTES);
  return bytes;
}

/** Hashes the shingles of `texts` and returns the index file bytes. The texts themselves are not kept. */
export function buildIndex(texts: Iterable<string>, options: BuildIndexOptions = {}): Uint8Array {
  const shingleSize = options.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  return encodeIndex(collectShingleKeys(texts, shingleSize), shingleSize);
}

/** Parses index file bytes; throws on a malformed, truncated or foreign file. */
export function loadIndex(bytes: Uint8Array): ShingleIndex {
  if (bytes.length < INDEX_HEADER_BYTES) throw new Error('shingle index: file shorter than its header');
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== INDEX_MAGIC) {
    throw new Error('shingle index: bad magic (not an LSHI file)');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== INDEX_FORMAT_VERSION) throw new Error(`shingle index: unsupported format version ${version}`);
  const shingleSize = view.getUint16(6, true);
  assertShingleSize(shingleSize);
  const count = view.getUint32(8, true);
  const normaliserVersion = view.getUint32(12, true);
  const keyBits = view.getUint8(16);
  if (keyBits !== KEY_BITS) throw new Error(`shingle index: unsupported key size ${keyBits} bits`);
  const k = view.getUint8(17);
  if (k > KEY_BITS) throw new Error(`shingle index: bad Rice parameter ${k}`);

  const totalBits = (bytes.length - INDEX_HEADER_BYTES) * 8;
  let position = 0;
  const bit = (): number => {
    if (position >= totalBits) throw new Error('shingle index: truncated body');
    const byte = bytes[INDEX_HEADER_BYTES + (position >> 3)] as number;
    return (byte >> (7 - (position++ & 7))) & 1;
  };

  const divisor = 2 ** k;
  const keys = new Float64Array(count);
  let previous = -1;
  for (let i = 0; i < count; i++) {
    let quotient = 0;
    while (bit() === 1) {
      if (++quotient * divisor >= KEY_LIMIT) throw new Error('shingle index: key overflows 40 bits');
    }
    let remainder = 0;
    for (let b = 0; b < k; b++) remainder = remainder * 2 + bit();
    const key = previous + 1 + quotient * divisor + remainder;
    if (key >= KEY_LIMIT) throw new Error('shingle index: key overflows 40 bits');
    keys[i] = key;
    previous = key;
  }
  if (totalBits - position >= 8) throw new Error('shingle index: trailing bytes after the last key');
  while (position < totalBits) {
    if (bit() !== 0) throw new Error('shingle index: non-zero padding');
  }

  return {
    shingleSize,
    normaliserVersion,
    size: count,
    has(key: number): boolean {
      let low = 0;
      let high = keys.length - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const value = keys[mid] as number;
        if (value === key) return true;
        if (value < key) low = mid + 1;
        else high = mid - 1;
      }
      return false;
    },
  };
}
