import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { ProviderError, createProviders } from '@lectio/providers';
import { server } from '@lectio/shared/test-server';

import {
  AZURE_OUTPUT_FORMAT,
  AzureTtsProvider,
  azureTts,
  azureTtsEndpoint,
  azureTtsFromEnv,
  errorForStatus,
  hasAzureTtsSecrets,
  mp3DurationMs,
  retryAfterMs,
  voiceFor,
} from './client.ts';
import type { AzureTtsOptions } from './client.ts';

const live = process.env['LECTIO_LIVE'] === '1';
const ENDPOINT = 'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1';
const VOICE = 'en-KE-AsiliaNeural';

interface Captured {
  readonly headers: Headers;
  readonly body: string;
}

/** Deterministic stand-in MP3 bytes: 6 bytes per character of the SSML's spoken text. */
function fakeMp3(ssml: string): Uint8Array {
  const spoken = /<voice [^>]*>([\s\S]*)<\/voice>/.exec(ssml)?.[1] ?? '';
  return Uint8Array.from({ length: spoken.length * 6 }, (_, i) => (spoken.charCodeAt(i % spoken.length) + i) % 256);
}

/** Answers synthesis requests with {@link fakeMp3} and records them. */
function serveAzure(captured: Captured[] = []): Captured[] {
  server.use(
    http.post(ENDPOINT, async ({ request }) => {
      const body = await request.text();
      captured.push({ headers: request.headers, body });
      return HttpResponse.arrayBuffer(fakeMp3(body).buffer as ArrayBuffer, {
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }),
  );
  return captured;
}

/** Answers with each queued status in turn, then with audio. */
function serveSequence(statuses: { status: number; headers?: Record<string, string>; body?: string }[]): number[] {
  const seen: number[] = [];
  server.use(
    http.post(ENDPOINT, async ({ request }) => {
      const next = statuses.shift();
      if (next) {
        seen.push(next.status);
        return new HttpResponse(next.body ?? null, { status: next.status, headers: next.headers });
      }
      seen.push(200);
      return HttpResponse.arrayBuffer(fakeMp3(await request.text()).buffer as ArrayBuffer);
    }),
  );
  return seen;
}

function provider(options: Partial<AzureTtsOptions> = {}, delays: number[] = []): AzureTtsProvider {
  return new AzureTtsProvider({
    key: 'test-key',
    region: 'westeurope',
    sleep: async (ms) => {
      delays.push(ms);
    },
    ...options,
  });
}

async function rejection(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe.skipIf(live)('AzureTtsProvider (msw)', () => {
  it('posts one SSML request with key, output format and user agent, and returns mp3', async () => {
    const captured = serveAzure();
    const result = await provider().synthesize({ text: 'Peace be with you.', voice: VOICE, format: 'mp3' });
    expect(captured).toHaveLength(1);
    const [request] = captured as [Captured];
    expect(request.headers.get('ocp-apim-subscription-key')).toBe('test-key');
    expect(request.headers.get('content-type')).toBe('application/ssml+xml');
    expect(request.headers.get('x-microsoft-outputformat')).toBe(AZURE_OUTPUT_FORMAT);
    expect(request.headers.get('user-agent')).toBe('lectio-tts');
    expect(request.body).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-KE">' +
        '<voice name="en-KE-AsiliaNeural">Peace be with you.</voice></speak>',
    );
    expect(result.format).toBe('mp3');
    expect(result.contentType).toBe('audio/mpeg');
    expect(Buffer.from(result.audio).equals(Buffer.from(fakeMp3(request.body)))).toBe(true);
    expect(result.durationMs).toBe(mp3DurationMs(result.audio.length));
    expect(result.characters).toBe(18);
  });

  it('escapes SSML special characters in the text', async () => {
    const captured = serveAzure();
    await provider().synthesize({ text: `Jesus said, "Fear not" & <rejoice>.`, voice: VOICE, format: 'mp3' });
    expect(captured[0]?.body).toContain(
      '<voice name="en-KE-AsiliaNeural">Jesus said, &quot;Fear not&quot; &amp; &lt;rejoice&gt;.</voice>',
    );
  });

  it('chunks long text at sentence boundaries and concatenates the audio in order', async () => {
    const captured = serveAzure();
    const sentences = ['First sentence of the commentary.', 'Second sentence follows.', 'Third and last one.'];
    const text = sentences.join(' ');
    const result = await provider({ maxChunkChars: 45 }).synthesize({ text, voice: 'sw-KE-ZuriNeural', format: 'mp3' });
    expect(captured.map((c) => /<voice [^>]*>(.*)<\/voice>/.exec(c.body)?.[1])).toEqual([
      sentences[0],
      sentences[1] + ' ' + sentences[2],
    ]);
    for (const c of captured) expect(c.body).toContain('xml:lang="sw-KE"');
    const expected = Buffer.concat(captured.map((c) => Buffer.from(fakeMp3(c.body))));
    expect(Buffer.from(result.audio).equals(expected)).toBe(true);
    expect(result.characters).toBe([...text].length);
  });

  it('uses an explicit endpoint instead of the region', async () => {
    const seen: string[] = [];
    server.use(
      http.post('https://speech.example.test/tts', ({ request }) => {
        seen.push(request.url);
        return HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer);
      }),
    );
    const tts = new AzureTtsProvider({ key: 'k', endpoint: 'https://speech.example.test/tts', userAgent: 'ua' });
    const result = await tts.synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' });
    expect(seen).toEqual(['https://speech.example.test/tts']);
    expect(result.durationMs).toBe(1);
  });

  it('retries 429 and 5xx with exponential backoff, then succeeds', async () => {
    const seen = serveSequence([{ status: 429 }, { status: 503 }, { status: 500 }]);
    const delays: number[] = [];
    const result = await provider({ baseDelayMs: 100 }, delays).synthesize({
      text: 'Hi.',
      voice: VOICE,
      format: 'mp3',
    });
    expect(seen).toEqual([429, 503, 500, 200]);
    expect(delays).toEqual([100, 200, 400]);
    expect(result.audio.length).toBeGreaterThan(0);
  });

  it('honours Retry-After, capped at maxDelayMs', async () => {
    serveSequence([
      { status: 429, headers: { 'Retry-After': '2' } },
      { status: 429, headers: { 'Retry-After': '60' } },
    ]);
    const delays: number[] = [];
    await provider({ maxDelayMs: 5000 }, delays).synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' });
    expect(delays).toEqual([2000, 5000]);
  });

  it('caps exponential backoff at maxDelayMs', async () => {
    serveSequence([{ status: 502 }, { status: 502 }, { status: 502 }]);
    const delays: number[] = [];
    await provider({ baseDelayMs: 1000, maxDelayMs: 1500 }, delays).synthesize({
      text: 'Hi.',
      voice: VOICE,
      format: 'mp3',
    });
    expect(delays).toEqual([1000, 1500, 1500]);
  });

  it('gives up after maxAttempts with the last retryable error', async () => {
    const seen = serveSequence([{ status: 503 }, { status: 503 }, { status: 503 }]);
    const error = await rejection(
      provider({ maxAttempts: 2 }).synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' }),
    );
    expect(seen).toEqual([503, 503]);
    expect(error.code).toBe('unavailable');
    expect(error.retryable).toBe(true);
  });

  it('fails fast on an auth error without retrying', async () => {
    const seen = serveSequence([{ status: 401, body: 'Access denied due to invalid subscription key.' }]);
    const delays: number[] = [];
    const error = await rejection(provider({}, delays).synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' }));
    expect(seen).toEqual([401]);
    expect(delays).toEqual([]);
    expect(error.code).toBe('invalid-request');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('rejected the credentials (401)');
    expect(error.message).toContain('AZURE_SPEECH_KEY');
    expect(error.message).toContain('invalid subscription key');
  });

  it('fails fast on a bad request', async () => {
    serveSequence([{ status: 400 }]);
    const error = await rejection(provider().synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' }));
    expect(error.code).toBe('invalid-request');
    expect(error.message).toBe('Azure Speech rejected the request (400)');
  });

  it('retries network errors, then reports them as unavailable', async () => {
    server.use(http.post(ENDPOINT, () => HttpResponse.error()));
    const delays: number[] = [];
    const error = await rejection(
      provider({ maxAttempts: 3 }, delays).synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' }),
    );
    expect(delays).toHaveLength(2);
    expect(error.code).toBe('unavailable');
    expect(error.message).toMatch(/^Azure Speech request failed: /);
  });

  it('uses global fetch and a real timer when nothing is injected', async () => {
    serveSequence([{ status: 503 }]);
    const tts = new AzureTtsProvider({ key: 'k', region: 'westeurope', baseDelayMs: 1 });
    expect((await tts.synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' })).audio.length).toBe(18);
  });

  it('treats an empty 200 body as malformed output', async () => {
    server.use(http.post(ENDPOINT, () => new HttpResponse(null, { status: 200 })));
    const error = await rejection(provider().synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' }));
    expect(error.code).toBe('malformed-output');
  });

  it('rejects empty text, unsupported formats and bad voices before sending anything', async () => {
    const captured = serveAzure();
    const tts = provider();
    expect((await rejection(tts.synthesize({ text: ' \u0001 ', voice: VOICE, format: 'mp3' }))).code).toBe(
      'invalid-request',
    );
    expect((await rejection(tts.synthesize({ text: 'Hi.', voice: VOICE, format: 'wav' }))).code).toBe('unsupported');
    expect((await rejection(tts.synthesize({ text: 'Hi.', voice: 'Asilia', format: 'mp3' }))).code).toBe(
      'invalid-request',
    );
    expect(captured).toEqual([]);
  });
});

describe('AzureTtsProvider (injected fetch)', () => {
  const ok = (): Response => new Response(new Uint8Array([9, 9]));

  it('maps a timeout to a retryable timeout error', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) throw timeout;
      return ok();
    }) as typeof fetch;
    const result = await provider({ fetch: fetchImpl }).synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' });
    expect(calls).toBe(2);
    expect(result.audio).toEqual(new Uint8Array([9, 9]));

    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const error = await rejection(
      provider({
        maxAttempts: 1,
        fetch: (async () => {
          throw aborted;
        }) as typeof fetch,
      }).synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' }),
    );
    expect(error.code).toBe('timeout');
    expect(error.cause).toBe(aborted);
  });

  it('reports non-Error throwables', async () => {
    const error = await rejection(
      provider({
        maxAttempts: 1,
        fetch: (async () => {
          throw 'boom';
        }) as typeof fetch,
      }).synthesize({ text: 'Hi.', voice: VOICE, format: 'mp3' }),
    );
    expect(error.message).toBe('Azure Speech request failed: boom');
  });

  it('survives an error body that cannot be read', async () => {
    const response = new Response('x', { status: 403 });
    Object.defineProperty(response, 'text', { value: () => Promise.reject(new Error('stream broke')) });
    const error = await rejection(
      provider({ fetch: (async () => response) as typeof fetch }).synthesize({
        text: 'Hi.',
        voice: VOICE,
        format: 'mp3',
      }),
    );
    expect(error.message).toMatch(/\(403\); check AZURE_SPEECH_KEY and AZURE_SPEECH_REGION$/);
  });
});

describe('AzureTtsProvider options', () => {
  it('validates key, region, endpoint and numeric limits', () => {
    expect(() => new AzureTtsProvider({ key: ' ', region: 'westeurope' })).toThrow('Azure Speech key is empty');
    expect(() => new AzureTtsProvider({ key: 'k' })).toThrow('needs a region or an endpoint');
    expect(() => new AzureTtsProvider({ key: 'k', region: 'West Europe' })).toThrow('not an Azure region name');
    expect(() => new AzureTtsProvider({ key: 'k', region: 'westeurope', maxChunkChars: 5001 })).toThrow(
      'maxChunkChars must be an integer from 1 to 5000, got 5001',
    );
    expect(() => new AzureTtsProvider({ key: 'k', region: 'westeurope', maxAttempts: 0 })).toThrow(RangeError);
    expect(() => new AzureTtsProvider({ key: 'k', region: 'westeurope', timeoutMs: 1.5 })).toThrow(RangeError);
    expect(new AzureTtsProvider({ key: 'k', region: 'westeurope' }).formats).toEqual(['mp3']);
  });
});

describe('helpers', () => {
  it('azureTtsEndpoint builds the regional URL', () => {
    expect(azureTtsEndpoint('westeurope')).toBe(ENDPOINT);
  });

  it('mp3DurationMs follows the 48 kbit/s bit rate', () => {
    expect(mp3DurationMs(6000)).toBe(1000);
    expect(mp3DurationMs(0)).toBe(0);
  });

  it('retryAfterMs reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-05T12:00:00Z');
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs(' ')).toBeUndefined();
    expect(retryAfterMs('1.5')).toBe(1500);
    expect(retryAfterMs('-3')).toBe(0);
    expect(retryAfterMs('Mon, 05 Oct 2026 12:00:03 GMT', now)).toBe(3000);
    expect(retryAfterMs('Mon, 05 Oct 2026 11:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('soon', now)).toBeUndefined();
    expect(retryAfterMs('Mon, 05 Oct 2099 00:00:00 GMT')).toBeGreaterThan(0);
  });

  it('errorForStatus maps statuses onto provider error codes', () => {
    const cases: [number, string, boolean][] = [
      [400, 'invalid-request', false],
      [401, 'invalid-request', false],
      [403, 'invalid-request', false],
      [404, 'not-found', false],
      [408, 'timeout', true],
      [415, 'invalid-request', false],
      [429, 'rate-limited', true],
      [500, 'unavailable', true],
      [503, 'unavailable', true],
    ];
    for (const [status, code, retryable] of cases) {
      const error = errorForStatus(status, 'detail');
      expect([error.code, error.retryable], String(status)).toEqual([code, retryable]);
      expect(error.message).toMatch(/: detail$/);
    }
  });

  it('hasAzureTtsSecrets needs both key and region', () => {
    expect(hasAzureTtsSecrets({})).toBe(false);
    expect(hasAzureTtsSecrets({ AZURE_SPEECH_KEY: 'k' })).toBe(false);
    expect(hasAzureTtsSecrets({ AZURE_SPEECH_KEY: ' ', AZURE_SPEECH_REGION: 'westeurope' })).toBe(false);
    expect(hasAzureTtsSecrets({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'westeurope' })).toBe(true);
  });

  it('azureTtsFromEnv builds a provider or explains what is missing', () => {
    expect(azureTtsFromEnv({ AZURE_SPEECH_KEY: ' k ', AZURE_SPEECH_REGION: ' westeurope ' })).toBeInstanceOf(
      AzureTtsProvider,
    );
    expect(() => azureTtsFromEnv({ AZURE_SPEECH_KEY: 'k' })).toThrow(
      'Azure TTS needs AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in the environment',
    );
    expect(() => azureTtsFromEnv({ AZURE_SPEECH_REGION: 'westeurope' })).toThrow(ProviderError);
  });

  it('azureTts is a createProviders live factory for the tts slot', () => {
    const env = { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'westeurope' };
    const set = createProviders(DEFAULT_CONFIG, env, { tts: azureTts });
    expect(set.tts).toBeInstanceOf(AzureTtsProvider);
    expect(set.fakes.has('tts')).toBe(false);
  });

  it('voiceFor reads config.tts.voices', () => {
    expect(voiceFor(DEFAULT_CONFIG, 'en')).toBe('en-KE-AsiliaNeural');
    expect(voiceFor(DEFAULT_CONFIG, 'sw')).toBe('sw-KE-ZuriNeural');
    expect(() => voiceFor(DEFAULT_CONFIG, 'fr')).toThrow('no TTS voice configured for locale "fr"');
  });
});
