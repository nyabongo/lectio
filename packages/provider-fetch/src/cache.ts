/**
 * On-disk cache of fetched pages (`.cache/sources`, git-ignored): one JSON file per URL, named by the URL's sha256,
 * reused for a time-to-live. Only successful pages (2xx) are stored, so a failure is retried next time.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import type { Clock } from '@lectio/providers';
import { sha256Hex } from '@lectio/providers';

import type { LiveFetchedSource } from './types.ts';

interface Entry {
  readonly url: string;
  /** Epoch ms when the entry was written. */
  readonly storedAt: number;
  readonly page: LiveFetchedSource;
}

function isWorkspaceRoot(dir: string): boolean {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    return 'workspaces' in (JSON.parse(readFileSync(manifest, 'utf8')) as object);
  } catch {
    return false;
  }
}

/**
 * The default cache directory: `<repo>/.cache/sources`, where the repo is the nearest ancestor of `INIT_CWD` (the
 * directory npm was run from) or `cwd` whose package.json declares workspaces; `<cwd>/.cache/sources` outside one.
 */
export function defaultSourceCacheDir(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  const base = resolve(env['INIT_CWD'] ?? cwd);
  for (let dir = base; ; dir = dirname(dir)) {
    if (isWorkspaceRoot(dir)) return join(dir, '.cache', 'sources');
    if (dirname(dir) === dir) return join(base, '.cache', 'sources');
  }
}

export class SourceCache {
  readonly #dir: string;
  readonly #ttlMs: number;
  readonly #clock: Clock;

  constructor(dir: string, ttlMs: number, clock: Clock) {
    this.#dir = dir;
    this.#ttlMs = ttlMs;
    this.#clock = clock;
  }

  #path(url: string): string {
    return join(this.#dir, `${sha256Hex(url)}.json`);
  }

  /** The cached page for `url` if it is younger than the TTL. A missing, unreadable or stale entry is a miss. */
  async get(url: string): Promise<LiveFetchedSource | undefined> {
    let entry: Entry;
    try {
      entry = JSON.parse(await readFile(this.#path(url), 'utf8')) as Entry;
    } catch {
      return undefined;
    }
    if (entry.url !== url || typeof entry.storedAt !== 'number') return undefined;
    if (this.#clock.now().getTime() - entry.storedAt >= this.#ttlMs) return undefined;
    return entry.page;
  }

  /** Stores a page, atomically (a temporary file renamed into place). */
  async put(url: string, page: LiveFetchedSource): Promise<void> {
    const entry: Entry = { url, storedAt: this.#clock.now().getTime(), page };
    const path = this.#path(url);
    await mkdir(this.#dir, { recursive: true });
    const partial = `${path}.${process.pid}.partial`;
    await writeFile(partial, `${JSON.stringify(entry)}\n`);
    await rename(partial, path);
  }
}
