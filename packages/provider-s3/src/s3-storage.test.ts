import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchBucket,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { ProviderError } from '@lectio/providers';
import { server } from '@lectio/shared/test-server';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';

import { IMMUTABLE_CACHE_CONTROL, NO_CACHE_CONTROL } from './cache-control.ts';
import { mockBucket } from './fixtures/mock-bucket.ts';
import { DEFAULT_CONTENT_TYPE, S3ObjectStorage, r2Endpoint } from './s3-storage.ts';

const meta = (httpStatusCode: number) => ({ httpStatusCode, attempts: 1, totalRetryDelay: 0 });
const HASH = '3f9a0c2b7d4e5f6011223344aabbccdd';

function setup(options: { pageSize?: number; listConcurrency?: number } = {}) {
  const bucket = mockBucket(options.pageSize);
  const storage = new S3ObjectStorage({
    bucket: 'lectio-audio',
    client: bucket.client,
    publicBaseUrl: 'https://audio.example.org/',
    ...(options.listConcurrency === undefined ? {} : { listConcurrency: options.listConcurrency }),
  });
  return { ...bucket, storage };
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('S3ObjectStorage put', () => {
  it('sends the bucket, key, body, length and content type', async () => {
    const { storage, mock } = setup();
    const info = await storage.put('audio/note.wav', Uint8Array.from([1, 2, 3]), { contentType: 'audio/wav' });
    const input = mock.commandCalls(PutObjectCommand)[0]?.args[0].input;
    expect(input).toMatchObject({
      Bucket: 'lectio-audio',
      Key: 'audio/note.wav',
      ContentLength: 3,
      ContentType: 'audio/wav',
    });
    expect(input?.CacheControl).toBeUndefined();
    expect(info).toEqual({
      key: 'audio/note.wav',
      size: 3,
      etag: expect.stringMatching(/^[0-9a-f]{32}$/),
      contentType: 'audio/wav',
    });
  });

  it('sets immutable Cache-Control on hashed keys and no-cache on the manifest by default', async () => {
    const { storage, mock } = setup();
    const audio = await storage.put(`audio/${HASH}.wav`, 'RIFF', { contentType: 'audio/wav' });
    const manifest = await storage.put('audio/manifest.json', '{}', { contentType: 'application/json' });
    const sent = mock.commandCalls(PutObjectCommand).map((call) => call.args[0].input.CacheControl);
    expect(sent).toEqual([IMMUTABLE_CACHE_CONTROL, NO_CACHE_CONTROL]);
    expect(audio.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(manifest.cacheControl).toBe(NO_CACHE_CONTROL);
    expect(await storage.head(`audio/${HASH}.wav`)).toEqual(audio);
    expect((await storage.head('audio/manifest.json'))?.cacheControl).toBe(NO_CACHE_CONTROL);
  });

  it('lets an explicit cacheControl override the default', async () => {
    const { storage, mock } = setup();
    await storage.put('audio/manifest.json', '{}', { contentType: 'application/json', cacheControl: 'max-age=60' });
    expect(mock.commandCalls(PutObjectCommand)[0]?.args[0].input.CacheControl).toBe('max-age=60');
  });

  it('does not keep a reference to the caller buffer', async () => {
    const { storage, objects } = setup();
    const body = Uint8Array.from([1, 2, 3]);
    await storage.put('a', body, { contentType: 'application/octet-stream' });
    body[0] = 9;
    expect(objects.get('a')?.body[0]).toBe(1);
  });

  it('reads the object back when the service returns no ETag', async () => {
    const { storage, mock } = setup();
    mock.on(PutObjectCommand).resolvesOnce({ $metadata: meta(200) });
    mock
      .on(HeadObjectCommand)
      .resolvesOnce({ ETag: '"abc"', ContentLength: 2, ContentType: 'text/plain', $metadata: meta(200) });
    expect(await storage.put('k', 'hi', { contentType: 'text/plain' })).toEqual({
      key: 'k',
      size: 2,
      etag: 'abc',
      contentType: 'text/plain',
    });
  });

  it('fails when an ETag-less put is not visible afterwards', async () => {
    const { storage, mock } = setup();
    mock.on(PutObjectCommand).resolvesOnce({ $metadata: meta(200) });
    const error = await rejection(storage.put('k', 'hi', { contentType: 'text/plain' }));
    expect(error.code).toBe('unavailable');
  });

  it('maps service errors', async () => {
    const { storage, mock } = setup();
    mock
      .on(PutObjectCommand)
      .rejectsOnce(
        new S3ServiceException({ name: 'AccessDenied', $fault: 'client', message: 'denied', $metadata: meta(403) }),
      );
    const error = await rejection(storage.put('k', 'hi', { contentType: 'text/plain' }));
    expect(error).toMatchObject({ code: 'invalid-request', retryable: false });
    expect(error.message).toBe('s3 put "k" failed: AccessDenied: denied');
  });

  it('rejects invalid keys before calling the service', async () => {
    const { storage, mock } = setup();
    for (const key of ['', '/abs', 'a//b', 'a/./b', '../x', 'a\\b']) {
      expect((await rejection(storage.put(key, 'x', { contentType: 'text/plain' }))).code).toBe('invalid-request');
    }
    await rejection(storage.head('../x'));
    await rejection(storage.get('../x'));
    expect(mock.calls()).toHaveLength(0);
  });
});

describe('S3ObjectStorage head and get', () => {
  it('returns metadata and bytes, unquoting ETags', async () => {
    const { storage } = setup();
    const put = await storage.put('audio/manifest.json', '{"v":"ü"}', { contentType: 'application/json' });
    const head = await storage.head('audio/manifest.json');
    const got = await storage.get('audio/manifest.json');
    expect(head).toEqual(put);
    expect(got?.info).toEqual(put);
    expect(new TextDecoder().decode(got?.body)).toBe('{"v":"ü"}');
    expect(head?.etag).not.toContain('"');
  });

  it('fills defaults for sparse responses', async () => {
    const { storage, mock } = setup();
    mock.on(HeadObjectCommand).resolvesOnce({ ETag: 'W/"weak"', $metadata: meta(200) });
    expect(await storage.head('k')).toEqual({ key: 'k', size: 0, etag: 'weak', contentType: DEFAULT_CONTENT_TYPE });
    mock.on(GetObjectCommand).resolvesOnce({ ETag: 'bare', $metadata: meta(200) });
    expect(await storage.get('k')).toEqual({
      body: new Uint8Array(),
      info: { key: 'k', size: 0, etag: 'bare', contentType: DEFAULT_CONTENT_TYPE },
    });
  });

  it('uses the body length when the response has no Content-Length', async () => {
    const { storage, mock } = setup();
    mock.on(GetObjectCommand).resolvesOnce({
      ETag: '"e"',
      Body: { transformToByteArray: async () => Uint8Array.from([1, 2]) },
      $metadata: meta(200),
    } as never);
    expect((await storage.get('k'))?.info.size).toBe(2);
  });

  it('fails on a response without an ETag', async () => {
    const { storage, mock } = setup();
    mock.on(HeadObjectCommand).resolvesOnce({ $metadata: meta(200) });
    expect((await rejection(storage.head('k'))).code).toBe('malformed-output');
  });

  it('returns null for missing keys', async () => {
    const { storage } = setup();
    expect(await storage.head('missing')).toBeNull();
    expect(await storage.get('missing')).toBeNull();
  });

  it('maps a missing bucket and outages to errors', async () => {
    const { storage, mock } = setup();
    mock.on(HeadObjectCommand).rejectsOnce(new NoSuchBucket({ message: 'no bucket', $metadata: meta(404) }));
    expect((await rejection(storage.head('k'))).code).toBe('not-found');
    mock
      .on(GetObjectCommand)
      .rejectsOnce(
        new S3ServiceException({ name: 'InternalError', $fault: 'server', message: 'oops', $metadata: meta(500) }),
      );
    const error = await rejection(storage.get('k'));
    expect(error).toMatchObject({ code: 'unavailable', retryable: true });
    expect(error.message).toContain('s3 get "k"');
  });
});

describe('S3ObjectStorage list', () => {
  it('pages through listings, sorts by JS string order and fills metadata from HEAD', async () => {
    const { storage, mock } = setup({ pageSize: 2 });
    await storage.put(`audio/b/${HASH}.wav`, 'b', { contentType: 'audio/wav' });
    await storage.put('audio/a/1.wav', 'a', { contentType: 'audio/wav' });
    await storage.put('audio/\u{1F600}', 'astral', { contentType: 'text/plain' });
    await storage.put('audio/�', 'bmp', { contentType: 'text/plain' });
    await storage.put('other/x', 'x', { contentType: 'text/plain' });
    const infos = await storage.list('audio/');
    expect(infos.map((info) => info.key)).toEqual([
      'audio/a/1.wav',
      `audio/b/${HASH}.wav`,
      'audio/\u{1F600}',
      'audio/�',
    ]);
    expect(infos[1]).toMatchObject({ contentType: 'audio/wav', cacheControl: IMMUTABLE_CACHE_CONTROL, size: 1 });
    const pages = mock.commandCalls(ListObjectsV2Command).map((call) => call.args[0].input);
    expect(pages).toEqual([
      { Bucket: 'lectio-audio', Prefix: 'audio/' },
      { Bucket: 'lectio-audio', Prefix: 'audio/', ContinuationToken: '2' },
    ]);
  });

  it('lists the whole bucket without a prefix', async () => {
    const { storage, mock } = setup();
    expect(await storage.list()).toEqual([]);
    await storage.put('z', 'z', { contentType: 'text/plain' });
    expect((await storage.list()).map((info) => info.key)).toEqual(['z']);
    expect(mock.commandCalls(ListObjectsV2Command)[0]?.args[0].input).toEqual({ Bucket: 'lectio-audio' });
  });

  it('skips keys without a name and keys deleted before their HEAD', async () => {
    const { storage, mock } = setup();
    mock.on(ListObjectsV2Command).resolvesOnce({
      Contents: [{}, { Key: 'gone' }],
      IsTruncated: true,
      $metadata: meta(200),
    });
    expect(await storage.list()).toEqual([]);
  });

  it('keeps at most listConcurrency HEAD requests in flight', async () => {
    const { storage, mock, objects } = setup({ pageSize: 100, listConcurrency: 2 });
    for (let i = 0; i < 7; i++) await storage.put(`k/${i}`, String(i), { contentType: 'text/plain' });
    let inFlight = 0;
    let peak = 0;
    mock.on(HeadObjectCommand).callsFake(async (input: { Key: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return { ETag: `"${objects.get(input.Key)?.etag}"`, ContentLength: 1, $metadata: meta(200) };
    });
    expect(await storage.list('k/')).toHaveLength(7);
    expect(peak).toBe(2);
  });

  it('maps listing errors', async () => {
    const { storage, mock } = setup();
    mock
      .on(ListObjectsV2Command)
      .rejectsOnce(
        new S3ServiceException({ name: 'SlowDown', $fault: 'server', message: 'slow', $metadata: meta(503) }),
      );
    const error = await rejection(storage.list('audio/'));
    expect(error).toMatchObject({ code: 'rate-limited', retryable: true });
    expect(error.message).toContain('s3 list "audio/"');
  });
});

describe('S3ObjectStorage options', () => {
  it('builds its own client for AWS S3 when given only a region', () => {
    const storage = new S3ObjectStorage({ bucket: 'b', region: 'eu-west-1' });
    expect(storage.bucket).toBe('b');
  });

  it('validates the bucket and list concurrency', () => {
    expect(() => new S3ObjectStorage({ bucket: '' })).toThrow(ProviderError);
    expect(() => new S3ObjectStorage({ bucket: 'b', listConcurrency: 0 })).toThrow(/positive integer/);
    expect(() => new S3ObjectStorage({ bucket: 'b', listConcurrency: 1.5 })).toThrow(/positive integer/);
  });

  it('builds public URLs with encoded segments', () => {
    const { storage } = setup();
    expect(storage.publicUrl(`audio/${HASH}.wav`)).toBe(`https://audio.example.org/audio/${HASH}.wav`);
    expect(storage.publicUrl('audio/a b#?.wav')).toBe('https://audio.example.org/audio/a%20b%23%3F.wav');
    const noSlash = new S3ObjectStorage({
      bucket: 'b',
      client: mockBucket().client,
      publicBaseUrl: 'https://cdn.example.org/a',
    });
    expect(noSlash.publicUrl('x')).toBe('https://cdn.example.org/a/x');
    expect(() => noSlash.publicUrl('../x')).toThrow(ProviderError);
  });

  it('refuses public URLs without a base', () => {
    const storage = new S3ObjectStorage({ bucket: 'b', client: mockBucket().client });
    expect(() => storage.publicUrl('x')).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });

  it('derives the R2 endpoint from an account id', () => {
    expect(r2Endpoint('0123abcd')).toBe('https://0123abcd.r2.cloudflarestorage.com');
    expect(() => r2Endpoint('')).toThrow(ProviderError);
    expect(() => r2Endpoint('a.evil.org')).toThrow(ProviderError);
  });
});

describe('S3ObjectStorage over HTTP (msw)', () => {
  const endpoint = 'https://acct.r2.cloudflarestorage.com';
  const build = () =>
    new S3ObjectStorage({
      bucket: 'lectio-audio',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    });

  it('sends Cache-Control and Content-Type headers on the wire', async () => {
    const seen: Record<string, string | null>[] = [];
    server.use(
      http.put(`${endpoint}/lectio-audio/audio/*`, ({ request }) => {
        seen.push({
          cacheControl: request.headers.get('cache-control'),
          contentType: request.headers.get('content-type'),
          authorization: request.headers.get('authorization') && 'signed',
        });
        return new HttpResponse(null, { status: 200, headers: { ETag: '"0123"' } });
      }),
    );
    const storage = build();
    const info = await storage.put(`audio/${HASH}.wav`, 'RIFF', { contentType: 'audio/wav' });
    await storage.put('audio/manifest.json', '{}', { contentType: 'application/json' });
    expect(info).toMatchObject({ etag: '0123', size: 4, cacheControl: IMMUTABLE_CACHE_CONTROL });
    expect(seen).toEqual([
      { cacheControl: IMMUTABLE_CACHE_CONTROL, contentType: 'audio/wav', authorization: 'signed' },
      { cacheControl: NO_CACHE_CONTROL, contentType: 'application/json', authorization: 'signed' },
    ]);
  });

  it('treats a bodiless 404 on HEAD as a missing key', async () => {
    server.use(http.head(`${endpoint}/lectio-audio/missing`, () => new HttpResponse(null, { status: 404 })));
    expect(await build().head('missing')).toBeNull();
  });

  it('maps an access-denied response', async () => {
    server.use(
      http.get(
        `${endpoint}/lectio-audio/secret`,
        () =>
          new HttpResponse(
            '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>',
            { status: 403, headers: { 'Content-Type': 'application/xml' } },
          ),
      ),
    );
    const error = await rejection(build().get('secret'));
    expect(error).toMatchObject({ code: 'invalid-request', retryable: false });
    expect(error.message).toContain('AccessDenied');
  });
});
