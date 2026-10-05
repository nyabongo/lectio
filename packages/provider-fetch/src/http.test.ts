import { ProviderError } from '@lectio/providers';
import { server } from '@lectio/shared/test-server';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { HttpClient, parseHttpUrl, retryAfterMs, USER_AGENT } from './http.ts';
import type { HttpOptions } from './http.ts';
import { packageName } from './index.ts';

const URL_A = 'https://http.test/a';

function client(options: HttpOptions = {}): { client: HttpClient; sleeps: number[] } {
  const sleeps: number[] = [];
  const instance = new HttpClient(
    {
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      ...options,
    },
    1000,
  );
  return { client: instance, sleeps };
}

describe('HttpClient', () => {
  it('exports its package name and User-Agent', () => {
    expect(packageName).toBe('@lectio/provider-fetch');
    expect(client().client.userAgent).toBe(USER_AGENT);
    expect(client({ userAgent: 'Other/1' }).client.userAgent).toBe('Other/1');
  });

  it('returns status, headers and body, sending the Accept header', async () => {
    server.use(
      http.get(URL_A, ({ request }) =>
        HttpResponse.text(request.headers.get('accept') ?? '', { headers: { 'x-test': '1' } }),
      ),
    );
    const result = await client().client.get(URL_A, { accept: 'text/plain' });
    expect(result.status).toBe(200);
    expect(result.headers.get('x-test')).toBe('1');
    expect(new TextDecoder().decode(result.body)).toBe('text/plain');
    expect(result.url).toBe(URL_A);
  });

  it('returns a redirect without a Location as is', async () => {
    server.use(http.get(URL_A, () => new HttpResponse(null, { status: 302 })));
    expect((await client().client.get(URL_A)).status).toBe(302);
  });

  it('retries network errors with backoff capped at maxBackoffMs, then rejects as unavailable', async () => {
    server.use(http.get(URL_A, () => HttpResponse.error()));
    const { client: c, sleeps } = client({ retries: 3, backoffMs: 400, maxBackoffMs: 1000 });
    const error = await c.get(URL_A).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'unavailable', retryable: true });
    expect((error as Error).message).toMatch(/^GET https:\/\/http\.test\/a: /);
    expect(sleeps).toEqual([400, 800, 1000]);
  });

  it('times out a slow attempt', async () => {
    server.use(
      http.get(URL_A, async () => {
        await delay(500);
        return HttpResponse.text('late');
      }),
    );
    const error = await client({ timeoutMs: 20, retries: 0 })
      .client.get(URL_A)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'timeout', message: `GET ${URL_A}: timed out after 20 ms` });
  });

  it('does not retry a failure that is not retryable', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new ProviderError('invalid-request', 'bad');
    }) as unknown as typeof fetch;
    await expect(client({ fetch: fetchImpl }).client.get(URL_A)).rejects.toThrow('bad');
    expect(calls).toBe(1);
  });

  it('reports a non-Error rejection', async () => {
    const fetchImpl = (() => Promise.reject('offline')) as unknown as typeof fetch;
    await expect(client({ fetch: fetchImpl, retries: 0 }).client.get(URL_A)).rejects.toThrow(`GET ${URL_A}: offline`);
  });

  it('uses the default sleep between retries', async () => {
    let calls = 0;
    server.use(
      http.get(URL_A, () => {
        calls += 1;
        return calls === 1 ? new HttpResponse(null, { status: 500 }) : HttpResponse.text('ok');
      }),
    );
    const c = new HttpClient({ backoffMs: 1 }, 1000);
    expect((await c.get(URL_A)).status).toBe(200);
  });

  it('refuses a redirect to a non-http URL', async () => {
    server.use(http.get(URL_A, () => new HttpResponse(null, { status: 301, headers: { location: 'file:///etc' } })));
    await expect(client().client.get(URL_A)).rejects.toMatchObject({ code: 'invalid-request' });
  });
});

describe('parseHttpUrl', () => {
  it('accepts http and https and refuses anything else', () => {
    expect(parseHttpUrl('http://x.test/a').href).toBe('http://x.test/a');
    expect(() => parseHttpUrl('not a url')).toThrow('not an http(s) URL: not a url');
    expect(() => parseHttpUrl('data:text/plain,x')).toThrow(ProviderError);
  });
});

describe('retryAfterMs', () => {
  it('reads delta-seconds and HTTP dates', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs(' 3 ')).toBe(3000);
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
    expect(retryAfterMs('Wed, 31 Dec 2025 23:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('soon')).toBeUndefined();
    expect(retryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT')).toBe(0);
  });
});
