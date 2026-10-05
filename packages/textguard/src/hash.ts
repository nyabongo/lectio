/**
 * Hashes: FNV-1a 64 per word, a 64-bit polynomial rolling hash over each window
 * of `n` word hashes, a splitmix64 finaliser, then truncation to a
 * {@link KEY_BITS}-bit shingle key (a plain number, exact in a double).
 */

/** Default shingle length in words (the `licenceGuard` config may override it). */
export const DEFAULT_SHINGLE_SIZE = 8;

/**
 * Bits kept per shingle key. With N keys in the index, a shingle that is not in
 * the source matches by accident with probability N / 2^40 (about 1.6e-6 for
 * the ~1.7M keys of the WEB + Douay-Rheims index).
 */
export const KEY_BITS = 40;

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const BASE = 0x9e3779b97f4a7c15n;
const KEY_SHIFT = BigInt(64 - KEY_BITS);

const u64 = (value: bigint): bigint => BigInt.asUintN(64, value);

/** FNV-1a 64 over the UTF-16 code units of a normalised word. Never stored: only shingle keys are. */
export function wordHash(word: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < word.length; i++) {
    h = u64((h ^ BigInt(word.charCodeAt(i))) * FNV_PRIME);
  }
  return h;
}

/** splitmix64's finaliser: a bijection on 64-bit values. */
export function mix64(value: bigint): bigint {
  let z = u64(value);
  z = u64((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
  z = u64((z ^ (z >> 27n)) * 0x94d049bb133111ebn);
  return z ^ (z >> 31n);
}

/** Throws unless `n` is a usable shingle size (an integer from 2 to 64). */
export function assertShingleSize(n: number): void {
  if (!Number.isInteger(n) || n < 2 || n > 64) {
    throw new RangeError(`shingle size must be an integer from 2 to 64, got ${n}`);
  }
}

const toKey = (h: bigint): number => Number(mix64(h) >> KEY_SHIFT);

/**
 * The {@link KEY_BITS}-bit key of every window of `n` consecutive word hashes,
 * in order: entry `i` covers words `i … i + n - 1`. Fewer than `n` words give no keys.
 */
export function shingleKeys(words: readonly bigint[], n: number): number[] {
  assertShingleSize(n);
  if (words.length < n) return [];
  let top = 1n; // BASE^(n-1): the weight of the word leaving the window
  for (let k = 1; k < n; k++) top = u64(top * BASE);
  let h = 0n;
  for (let i = 0; i < n; i++) h = u64(h * BASE + (words[i] as bigint));
  const keys = [toKey(h)];
  for (let i = n; i < words.length; i++) {
    h = u64((h - (words[i - n] as bigint) * top) * BASE + (words[i] as bigint));
    keys.push(toKey(h));
  }
  return keys;
}
