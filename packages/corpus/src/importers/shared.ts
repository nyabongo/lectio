/**
 * What the corpus importers share: the download wrapper that turns any failure of the injected downloader into a
 * CorpusError, and the atomic replacement of an edition directory.
 *
 * The live downloader is `LiveDownloader` from `@lectio/provider-fetch`, injected by the `scripts/corpus/import-*.mjs`
 * wrappers (ADR 0005); tests inject fakes.
 */
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { CorpusError } from '../format.ts';
import type { Downloader } from '../import/download.ts';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wraps a downloader so a failure (network error, HTTP error, timeout) rejects with a CorpusError naming the URL,
 * which the import CLIs report as a corpus failure instead of crashing.
 */
export function corpusDownloader(downloader: Downloader): Downloader {
  return {
    async fetchBytes(url) {
      try {
        return await downloader.fetchBytes(url);
      } catch (error) {
        if (error instanceof CorpusError) throw error;
        const text = message(error);
        throw new CorpusError(text.includes(url) ? text : `GET ${url}: ${text}`, { cause: error });
      }
    },
  };
}

/** Renames a directory; injectable so tests can make a step of the swap fail. */
export type RenameDir = (from: string, to: string) => Promise<void>;

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * Moves `staged` to `target`. An existing `target` is first moved to `backup` and moved back if the swap fails; if
 * even that fails, the backup is left where it is and the error says so. `backup` sits outside the staging
 * directory, so removing the staging directory afterwards can never delete it.
 */
async function swapIn(staged: string, target: string, backup: string, renameDir: RenameDir): Promise<void> {
  let hadOld = true;
  try {
    await renameDir(target, backup);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    hadOld = false;
  }
  try {
    await renameDir(staged, target);
  } catch (error) {
    if (hadOld) {
      try {
        await renameDir(backup, target);
      } catch (restoreError) {
        throw new CorpusError(
          `could not move the new edition into ${target} (${message(error)}) nor restore the previous one ` +
            `(${message(restoreError)}); the previous edition is kept at ${backup}`,
          { cause: error },
        );
      }
    }
    throw error;
  }
  if (hadOld) await rm(backup, { recursive: true, force: true });
}

/**
 * Rebuilds `<root>/<edition>` atomically. `write` receives a fresh staging root (`<root>/.staging-<edition>-XXXXXX`,
 * a dot-folder that `listSubdirectories` skips and git ignores) and writes `<staging root>/<edition>` there; only
 * when it has finished is the result renamed over the edition. A failure part-way leaves the previous edition (or
 * no edition) in place, never a partial one, and no staging directory behind.
 */
export async function replaceEdition<T>(
  root: string,
  edition: string,
  write: (stagingRoot: string) => Promise<T>,
  renameDir: RenameDir = rename,
): Promise<T> {
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(join(root, `.staging-${edition}-`));
  try {
    const result = await write(staging);
    await swapIn(join(staging, edition), join(root, edition), `${staging}-previous`, renameDir);
    return result;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
