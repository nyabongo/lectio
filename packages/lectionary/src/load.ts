/**
 * Reads `calendar/lectionary/`: the source registry and every block's data files.
 *
 * Layout: `sources.json`, then one directory per block (`seed`, …) holding `*.json` data files.
 * The directories `crosscheck`, `disputes` and `import` are tooling, not blocks.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseRegistry } from './sources.ts';
import type { LoadedFile, SourceRegistry } from './types.ts';
import { validateBlockFile } from './validate.ts';

export const RESERVED_DIRS = ['crosscheck', 'disputes', 'import'] as const;

export interface LoadResult {
  readonly registry: SourceRegistry;
  readonly files: readonly LoadedFile[];
  readonly problems: readonly string[];
}

async function readJson(path: string, label: string, problems: string[]): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    problems.push(`${label}: ${(error as Error).message}`);
    return undefined;
  }
}

/** The block directories under `root`, sorted. */
export async function listBlocks(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !(RESERVED_DIRS as readonly string[]).includes(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Reads the registry from `root/sources.json`. */
export async function loadRegistry(root: string): Promise<{ registry: SourceRegistry; problems: string[] }> {
  const problems: string[] = [];
  const json = await readJson(join(root, 'sources.json'), 'sources.json', problems);
  if (json === undefined) return { registry: { sources: {} }, problems };
  return parseRegistry(json);
}

/** Reads one block's data files (sorted by name); shape-invalid files are reported, not returned. */
export async function loadBlock(root: string, block: string): Promise<{ files: LoadedFile[]; problems: string[] }> {
  const dir = join(root, block);
  const problems: string[] = [];
  if (!existsSync(dir)) return { files: [], problems: [`block "${block}" does not exist (${dir})`] };
  const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
  const files: LoadedFile[] = [];
  for (const name of names) {
    const path = `${block}/${name}`;
    const json = await readJson(join(dir, name), path, problems);
    if (json === undefined) continue;
    const { data, problems: found } = validateBlockFile(json, path);
    problems.push(...found);
    if (data !== undefined) files.push({ block, path, data });
  }
  return { files, problems };
}

/** Reads the registry and every block (or only `blocks`, when given). */
export async function loadLectionary(root: string, blocks?: readonly string[]): Promise<LoadResult> {
  const { registry, problems } = await loadRegistry(root);
  const files: LoadedFile[] = [];
  for (const block of blocks ?? (await listBlocks(root))) {
    const loaded = await loadBlock(root, block);
    files.push(...loaded.files);
    problems.push(...loaded.problems);
  }
  return { registry, files, problems };
}
