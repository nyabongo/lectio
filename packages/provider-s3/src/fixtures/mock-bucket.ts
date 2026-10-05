/**
 * An in-memory S3 bucket behind aws-sdk-client-mock, so the real `S3ObjectStorage`
 * code paths (commands, ETags, pagination, missing-key errors) run offline.
 */
import { createHash } from 'node:crypto';

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  GetObjectCommandInput,
  HeadObjectCommandInput,
  ListObjectsV2CommandInput,
  PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import type { AwsClientStub } from 'aws-sdk-client-mock';

export interface MockObject {
  readonly body: Uint8Array;
  readonly etag: string;
  readonly contentType?: string;
  readonly cacheControl?: string;
}

export interface MockBucket {
  readonly client: S3Client;
  readonly mock: AwsClientStub<S3Client>;
  readonly objects: Map<string, MockObject>;
}

const metadata = { httpStatusCode: 200, attempts: 1, totalRetryDelay: 0 };
const missing = { httpStatusCode: 404, attempts: 1, totalRetryDelay: 0 };

function bodyBytes(body: PutObjectCommandInput['Body']): Uint8Array {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return Uint8Array.from(body);
  throw new Error('mock bucket only accepts string or Uint8Array bodies');
}

/** A fresh, empty bucket. `pageSize` keeps listings small so pagination is exercised. */
export function mockBucket(pageSize = 2): MockBucket {
  const client = new S3Client({
    region: 'auto',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });
  const mock = mockClient(client);
  const objects = new Map<string, MockObject>();

  const lookup = (key: string | undefined, kind: 'head' | 'get'): MockObject => {
    const object = key === undefined ? undefined : objects.get(key);
    if (object) return object;
    throw kind === 'head'
      ? new NotFound({ message: 'UnknownError', $metadata: missing })
      : new NoSuchKey({ message: 'The specified key does not exist.', $metadata: missing });
  };
  const headers = (object: MockObject) => ({
    ContentLength: object.body.length,
    ETag: `"${object.etag}"`,
    ...(object.contentType === undefined ? {} : { ContentType: object.contentType }),
    ...(object.cacheControl === undefined ? {} : { CacheControl: object.cacheControl }),
    $metadata: metadata,
  });

  mock.on(PutObjectCommand).callsFake((input: PutObjectCommandInput) => {
    const body = bodyBytes(input.Body);
    const etag = createHash('md5').update(body).digest('hex');
    objects.set(input.Key as string, {
      body,
      etag,
      ...(input.ContentType === undefined ? {} : { contentType: input.ContentType }),
      ...(input.CacheControl === undefined ? {} : { cacheControl: input.CacheControl }),
    });
    return { ETag: `"${etag}"`, $metadata: metadata };
  });
  mock.on(HeadObjectCommand).callsFake((input: HeadObjectCommandInput) => headers(lookup(input.Key, 'head')));
  mock.on(GetObjectCommand).callsFake((input: GetObjectCommandInput) => {
    const object = lookup(input.Key, 'get');
    return {
      ...headers(object),
      Body: { transformToByteArray: async () => Uint8Array.from(object.body) },
    };
  });
  mock.on(ListObjectsV2Command).callsFake((input: ListObjectsV2CommandInput) => {
    // S3 orders listings by UTF-8 bytes, which differs from JS order for astral characters.
    const keys = [...objects.keys()]
      .filter((key) => key.startsWith(input.Prefix ?? ''))
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    const start = input.ContinuationToken === undefined ? 0 : Number(input.ContinuationToken);
    const page = keys.slice(start, start + pageSize);
    const next = start + pageSize;
    return {
      ...(page.length === 0 ? {} : { Contents: page.map((Key) => ({ Key, Size: objects.get(Key)?.body.length })) }),
      IsTruncated: next < keys.length,
      ...(next < keys.length ? { NextContinuationToken: String(next) } : {}),
      KeyCount: page.length,
      $metadata: metadata,
    };
  });
  return { client, mock, objects };
}
