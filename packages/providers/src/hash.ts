import { createHash } from 'node:crypto';

/**
 * JSON with object keys sorted at every level, so equal values always serialise
 * (and hash) the same way. `undefined` properties are dropped, as in JSON.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** Hex sha256 of a string or bytes. */
export function sha256Hex(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

/** A deterministic pseudo-random sequence in [0, 1) derived from a seed string (mulberry32). */
export function seededRandom(seed: string): () => number {
  let state = Number.parseInt(sha256Hex(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
