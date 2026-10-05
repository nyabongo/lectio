import { ProviderError } from '@lectio/providers';
import { server } from '@lectio/shared/test-server';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { LiveDownloader } from './downloader.ts';
import { USER_AGENT } from './http.ts';

const URL_A = 'https://downloads.test/archive.tar.gz';

describe('LiveDownloader', () => {
  it('returns the body bytes after redirects, as LectioBot, without consulting robots.txt', async () => {
    let agent: string | null = null;
    server.use(
      http.get(URL_A, () => new HttpResponse(null, { status: 302, headers: { location: '/real.tar.gz' } })),
      http.get('https://downloads.test/real.tar.gz', ({ request }) => {
        agent = request.headers.get('user-agent');
        return HttpResponse.arrayBuffer(Uint8Array.from([1, 2, 3]).buffer);
      }),
    );
    expect(await new LiveDownloader().fetchBytes(URL_A)).toEqual(Uint8Array.from([1, 2, 3]));
    expect(agent).toBe(USER_AGENT);
  });

  it.each([
    [404, 'not-found'],
    [410, 'not-found'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
    [403, 'invalid-request'],
    [304, 'invalid-request'],
  ])('rejects HTTP %i as %s', async (status, code) => {
    server.use(http.get(URL_A, () => new HttpResponse(null, { status })));
    const error = await new LiveDownloader({ retries: 0 }).fetchBytes(URL_A).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code, message: `GET ${URL_A}: HTTP ${status}` });
  });

  it('rejects a network failure', async () => {
    server.use(http.get(URL_A, () => HttpResponse.error()));
    await expect(new LiveDownloader({ retries: 0 }).fetchBytes(URL_A)).rejects.toMatchObject({ code: 'unavailable' });
  });
});
