import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@lectio/shared/test-server';

import { createFakeDownloader, createFetchDownloader } from './download.ts';

describe('createFetchDownloader', () => {
  it('returns the response bytes (global fetch by default)', async () => {
    server.use(http.get('https://example.org/a.zip', () => HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer)));
    await expect(createFetchDownloader().download('https://example.org/a.zip')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('rejects on a non-2xx status', async () => {
    server.use(http.get('https://example.org/missing.zip', () => new HttpResponse(null, { status: 404 })));
    await expect(createFetchDownloader(fetch).download('https://example.org/missing.zip')).rejects.toThrow(
      'download failed: https://example.org/missing.zip answered 404',
    );
  });
});

describe('createFakeDownloader', () => {
  it('serves known URLs, records calls and rejects unknown ones', async () => {
    const fake = createFakeDownloader({ 'https://x/1': new Uint8Array([9]) });
    await expect(fake.download('https://x/1')).resolves.toEqual(new Uint8Array([9]));
    await expect(fake.download('https://x/2')).rejects.toThrow('no file for https://x/2');
    expect(fake.calls).toEqual(['https://x/1', 'https://x/2']);
  });
});
