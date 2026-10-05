import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { ProviderError, assertValidKey } from '@lectio/providers';
import type { ObjectInfo, ObjectStorage, PutOptions, StoredObject } from '@lectio/providers';

import { defaultCacheControl } from './cache-control.ts';
import { isMissingObject, toProviderError } from './errors.ts';

/** Content type reported when the service returns none. */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
/** How many HEAD requests `list` runs at once to fill in content types. */
export const DEFAULT_LIST_CONCURRENCY = 8;

export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface S3ObjectStorageOptions {
  readonly bucket: string;
  /**
   * A ready client (tests inject one wrapped by aws-sdk-client-mock). When absent, one is
   * built from `endpoint`, `region` and `credentials`.
   */
  readonly client?: S3Client;
  /** S3-compatible endpoint, for example `https://<account>.r2.cloudflarestorage.com` (see {@link r2Endpoint}). */
  readonly endpoint?: string;
  /** `auto` for Cloudflare R2 (the default). */
  readonly region?: string;
  readonly credentials?: S3Credentials;
  /** Use path-style URLs (`<endpoint>/<bucket>/<key>`); needed by some S3-compatible services. */
  readonly forcePathStyle?: boolean;
  /** Public URL prefix of the bucket (`config.tts.storage.publicBaseUrl`); `''` when there is none. */
  readonly publicBaseUrl?: string;
  /** HEAD requests in flight at once during `list` (default {@link DEFAULT_LIST_CONCURRENCY}). */
  readonly listConcurrency?: number;
}

/**
 * The public URL of `key` under `publicBaseUrl` (`config.tts.storage.publicBaseUrl`), with
 * each path segment percent-encoded. Works with any `ObjectStorage`, since the shared
 * interface has no URL method. Throws `unsupported` when the base URL is `''`.
 */
export function publicUrlFor(publicBaseUrl: string, key: string): string {
  assertValidKey(key);
  if (publicBaseUrl === '') {
    throw new ProviderError('unsupported', 'no public base URL is configured for the audio bucket');
  }
  const base = publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`;
  return base + key.split('/').map(encodeURIComponent).join('/');
}

/** Narrows an `ObjectStorage` (for example `createProviders(...).storage`) to {@link S3ObjectStorage}. */
export function isS3ObjectStorage(storage: ObjectStorage): storage is S3ObjectStorage {
  return storage instanceof S3ObjectStorage;
}

/** The S3 API endpoint of a Cloudflare account's R2 storage. */
export function r2Endpoint(accountId: string): string {
  if (!/^[0-9a-z]+$/i.test(accountId)) {
    throw new ProviderError('invalid-request', `invalid Cloudflare account id: "${accountId}"`);
  }
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

function toBytes(body: Uint8Array | string): Uint8Array {
  return typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
}

/** S3 returns ETags in double quotes (`"9e10…"`); the quotes are not part of the hash. */
function unquote(etag: string): string {
  return etag.replace(/^(?:W\/)?"(.*)"$/, '$1');
}

interface ObjectMetadata {
  readonly ContentLength?: number;
  readonly ETag?: string;
  readonly ContentType?: string;
  readonly CacheControl?: string;
}

function infoFrom(key: string, metadata: ObjectMetadata, fallbackSize = 0): ObjectInfo {
  if (metadata.ETag === undefined) {
    throw new ProviderError('malformed-output', `s3 response for "${key}" has no ETag`);
  }
  return {
    key,
    size: metadata.ContentLength ?? fallbackSize,
    etag: unquote(metadata.ETag),
    contentType: metadata.ContentType ?? DEFAULT_CONTENT_TYPE,
    ...(metadata.CacheControl === undefined ? {} : { cacheControl: metadata.CacheControl }),
  };
}

/** Runs `task` over `items` with at most `limit` in flight, keeping input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * {@link ObjectStorage} on an S3-compatible bucket (Cloudflare R2 by default).
 *
 * - `put` sends `Cache-Control` from `PutOptions.cacheControl`, or else the key's
 *   default ({@link defaultCacheControl}): immutable for hashed keys, `no-cache` for manifests.
 * - `head` and `get` return `null` for missing keys; other failures become {@link ProviderError}s.
 * - `list` pages through ListObjectsV2 and then HEADs each key, because listings carry no
 *   content type or cache headers.
 */
export class S3ObjectStorage implements ObjectStorage {
  readonly bucket: string;
  readonly #client: S3Client;
  readonly #publicBaseUrl: string;
  readonly #listConcurrency: number;

  constructor(options: S3ObjectStorageOptions) {
    if (options.bucket === '') throw new ProviderError('invalid-request', 's3 bucket name is empty');
    const concurrency = options.listConcurrency ?? DEFAULT_LIST_CONCURRENCY;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new ProviderError('invalid-request', `listConcurrency must be a positive integer, got ${concurrency}`);
    }
    this.bucket = options.bucket;
    this.#publicBaseUrl = options.publicBaseUrl ?? '';
    this.#listConcurrency = concurrency;
    this.#client =
      options.client ??
      new S3Client({
        region: options.region ?? 'auto',
        ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
        ...(options.credentials === undefined ? {} : { credentials: options.credentials }),
        ...(options.forcePathStyle === undefined ? {} : { forcePathStyle: options.forcePathStyle }),
      });
  }

  async head(key: string): Promise<ObjectInfo | null> {
    assertValidKey(key);
    try {
      const response = await this.#client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return infoFrom(key, response);
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw toProviderError('head', key, error);
    }
  }

  async put(key: string, body: Uint8Array | string, options: PutOptions): Promise<ObjectInfo> {
    assertValidKey(key);
    const bytes = toBytes(body);
    const cacheControl = options.cacheControl ?? defaultCacheControl(key);
    let etag: string | undefined;
    try {
      const response = await this.#client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentLength: bytes.length,
          ContentType: options.contentType,
          ...(cacheControl === undefined ? {} : { CacheControl: cacheControl }),
        }),
      );
      etag = response.ETag;
    } catch (error) {
      throw toProviderError('put', key, error);
    }
    if (etag === undefined) {
      // Some S3-compatible services omit the ETag on PUT; read back what was stored.
      const stored = await this.head(key);
      if (!stored) throw new ProviderError('unavailable', `s3 put "${key}" succeeded but the object is not visible`);
      return stored;
    }
    return infoFrom(key, {
      ETag: etag,
      ContentLength: bytes.length,
      ContentType: options.contentType,
      CacheControl: cacheControl,
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    try {
      const response = await this.#client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = response.Body ? await response.Body.transformToByteArray() : new Uint8Array();
      return { body: Uint8Array.from(body), info: infoFrom(key, response, body.length) };
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw toProviderError('get', key, error);
    }
  }

  async list(prefix = ''): Promise<readonly ObjectInfo[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      let page;
      try {
        page = await this.#client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            ...(prefix === '' ? {} : { Prefix: prefix }),
            ...(token === undefined ? {} : { ContinuationToken: token }),
          }),
        );
      } catch (error) {
        throw toProviderError('list', prefix, error);
      }
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined) keys.push(object.Key);
      }
      token = undefined;
      if (page.IsTruncated) {
        if (page.NextContinuationToken === undefined || page.NextContinuationToken === '') {
          // Stopping here would return a silently short listing.
          throw new ProviderError('malformed-output', `s3 list "${prefix}" is truncated but has no continuation token`);
        }
        token = page.NextContinuationToken;
      }
    } while (token !== undefined);
    // S3 sorts by UTF-8 bytes; sort by JS string order to match the other ObjectStorage implementations.
    keys.sort();
    const infos = await mapLimit(keys, this.#listConcurrency, (key) => this.head(key));
    // A key deleted between the listing and its HEAD is skipped.
    return infos.filter((info): info is ObjectInfo => info !== null);
  }

  /**
   * The public URL of `key` under `publicBaseUrl` (see {@link publicUrlFor}).
   * Throws `unsupported` when the bucket has no public base URL.
   */
  publicUrl(key: string): string {
    return publicUrlFor(this.#publicBaseUrl, key);
  }
}
