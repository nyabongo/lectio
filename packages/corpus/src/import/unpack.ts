/**
 * Unpack a downloaded archive and write corpus files in the canonical, deterministic form.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { x as extractTar } from 'tar';

import {
  assertBookCode,
  assertEditionId,
  LICENSE_FILE,
  segment,
  serialiseChapter,
  serialiseSource,
  SOURCE_FILE,
} from '../format.ts';
import type { ChapterVerses, SourceInfo } from '../format.ts';

export interface UnpackOptions {
  /** Leading path components to drop, e.g. 1 for GitHub archives (`repo-<sha>/…`). Default 0. */
  readonly strip?: number;
}

/**
 * Extracts a .tar, .tar.gz or .tgz archive (compression is detected) into `destDir`, creating it if needed.
 * Entries that would escape `destDir` (absolute paths, `..`) are refused by tar's defaults.
 */
export async function unpackTarball(archivePath: string, destDir: string, options: UnpackOptions = {}): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await extractTar({ file: archivePath, cwd: destDir, strip: options.strip ?? 0 });
}

/** Writes `corpus/<edition>/SOURCE.json` and `LICENSE.md`. */
export async function writeEditionMetadata(
  root: string,
  edition: string,
  source: SourceInfo,
  licenceText: string,
): Promise<void> {
  assertEditionId(edition);
  const dir = join(root, edition);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, SOURCE_FILE), serialiseSource(source));
  await writeFile(join(dir, LICENSE_FILE), licenceText.endsWith('\n') ? licenceText : `${licenceText}\n`);
}

/** Writes `corpus/<edition>/<BOOK>/<chapter>.json`. */
export async function writeChapter(
  root: string,
  edition: string,
  book: string,
  chapter: number | string,
  verses: ChapterVerses,
): Promise<void> {
  assertEditionId(edition);
  assertBookCode(book);
  const dir = join(root, edition, book);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${segment('chapter', chapter)}.json`), serialiseChapter(verses));
}
