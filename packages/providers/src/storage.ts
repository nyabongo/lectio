import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

import { ProviderError } from './errors.ts';
import { sha256Hex } from './hash.ts';

export interface ObjectInfo {
  readonly key: string;
  readonly size: number;
  /** Content hash; equal bodies have equal etags within one provider. */
  readonly etag: string;
  readonly contentType: string;
  readonly cacheControl?: string;
}

export interface PutOptions {
  readonly contentType: string;
  /** For example `public, max-age=31536000, immutable` for hashed keys, `no-cache` for manifests. */
  readonly cacheControl?: string;
}

export interface StoredObject {
  readonly body: Uint8Array;
  readonly info: ObjectInfo;
}

/** A key/value object store (S3-compatible buckets in production). */
export interface ObjectStorage {
  /** Metadata, or `null` when the key does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Creates or replaces an object. */
  put(key: string, body: Uint8Array | string, options: PutOptions): Promise<ObjectInfo>;
  get(key: string): Promise<StoredObject | null>;
  /** Objects whose key starts with `prefix`, sorted by key. */
  list(prefix?: string): Promise<readonly ObjectInfo[]>;
}

/** Keys are relative slash paths without empty, `.` or `..` segments. */
export function assertValidKey(key: string): void {
  const segments = key.split('/');
  if (key === '' || key.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new ProviderError('invalid-request', `invalid object key: "${key}"`);
  }
}

function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
}

function infoFor(key: string, body: Uint8Array, options: PutOptions): ObjectInfo {
  return {
    key,
    size: body.length,
    etag: sha256Hex(body).slice(0, 32),
    contentType: options.contentType,
    ...(options.cacheControl === undefined ? {} : { cacheControl: options.cacheControl }),
  };
}

/** In-memory object storage. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly #objects = new Map<string, StoredObject>();

  async head(key: string): Promise<ObjectInfo | null> {
    assertValidKey(key);
    return this.#objects.get(key)?.info ?? null;
  }

  async put(key: string, body: Uint8Array | string, options: PutOptions): Promise<ObjectInfo> {
    assertValidKey(key);
    const bytes = toBytes(body);
    const info = infoFor(key, bytes, options);
    this.#objects.set(key, { body: bytes, info });
    return info;
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    const stored = this.#objects.get(key);
    return stored ? { body: Uint8Array.from(stored.body), info: stored.info } : null;
  }

  async list(prefix = ''): Promise<readonly ObjectInfo[]> {
    return [...this.#objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((key) => (this.#objects.get(key) as StoredObject).info);
  }
}

/**
 * Object storage on the local filesystem: bodies under `<root>/objects/<key>.body`,
 * metadata under `<root>/meta/<key>.json`. The suffixes let `a` and `a/b` coexist, as in S3. Used for `tts.storage.provider: fs` and
 * for inspecting rendered audio locally.
 */
export class FsObjectStorage implements ObjectStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    assertValidKey(key);
    try {
      return JSON.parse(await readFile(this.#metaPath(key), 'utf8')) as ObjectInfo;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async put(key: string, body: Uint8Array | string, options: PutOptions): Promise<ObjectInfo> {
    assertValidKey(key);
    const bytes = toBytes(body);
    const info = infoFor(key, bytes, options);
    const objectPath = join(this.#root, 'objects', `${key}.body`);
    await mkdir(dirname(objectPath), { recursive: true });
    await mkdir(dirname(this.#metaPath(key)), { recursive: true });
    await writeFile(objectPath, bytes);
    await writeFile(this.#metaPath(key), JSON.stringify(info));
    return info;
  }

  async get(key: string): Promise<StoredObject | null> {
    const info = await this.head(key);
    if (!info) return null;
    const body = new Uint8Array(await readFile(join(this.#root, 'objects', `${key}.body`)));
    return { body, info };
  }

  async list(prefix = ''): Promise<readonly ObjectInfo[]> {
    const metaRoot = join(this.#root, 'meta');
    let entries: Dirent[];
    try {
      entries = await readdir(metaRoot, { recursive: true, withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const keys = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) =>
        relative(metaRoot, join(entry.parentPath, entry.name)).split(sep).join('/').slice(0, -'.json'.length),
      )
      .filter((key) => key.startsWith(prefix))
      .sort();
    const infos = await Promise.all(keys.map((key) => this.head(key)));
    return infos.filter((info): info is ObjectInfo => info !== null);
  }

  #metaPath(key: string): string {
    return join(this.#root, 'meta', `${key}.json`);
  }
}
