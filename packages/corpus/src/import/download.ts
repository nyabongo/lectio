/**
 * Download an upstream corpus archive and refuse it unless its sha256 matches the pinned value. The network call
 * goes through the injected `Downloader` (the importers pass a provider from `@lectio/providers`; tests pass a
 * fake), so this module never touches the network itself.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { assertSha256, CorpusError } from '../format.ts';

/** Fetches the bytes behind a URL. Implementations throw on HTTP or network errors. */
export interface Downloader {
  fetchBytes(url: string): Promise<Uint8Array>;
}

export interface PinnedArchive {
  readonly url: string;
  /** Expected lower-case hex sha256 of the archive (the value recorded in SOURCE.json); upper case is rejected. */
  readonly sha256: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Throws a CorpusError unless `expected` is a lower-case hex sha256 and `bytes` hash to it. */
export function verifySha256(bytes: Uint8Array, expected: string, what: string): void {
  assertSha256(expected, what);
  const actual = sha256Hex(bytes);
  if (actual !== expected) {
    throw new CorpusError(`sha256 mismatch for ${what}: expected ${expected}, got ${actual}`);
  }
}

async function readIfPresent(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Ensures `dest` holds the pinned archive and returns its bytes. A file already at `dest` with the right hash is
 * reused without downloading; otherwise the archive is downloaded, verified, and only then written (atomically,
 * via a temporary file), so a bad download never leaves a file behind.
 */
export async function downloadPinned(downloader: Downloader, archive: PinnedArchive, dest: string): Promise<Uint8Array> {
  assertSha256(archive.sha256, archive.url);
  const existing = await readIfPresent(dest);
  if (existing !== undefined && sha256Hex(existing) === archive.sha256) return existing;
  const bytes = await downloader.fetchBytes(archive.url);
  verifySha256(bytes, archive.sha256, archive.url);
  await mkdir(dirname(dest), { recursive: true });
  const partial = `${dest}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, dest);
  return bytes;
}
