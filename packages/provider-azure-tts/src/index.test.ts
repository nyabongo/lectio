import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@lectio/config';
import { describeTtsContract } from '@lectio/providers/contracts';
import { server } from '@lectio/shared/test-server';

import { AzureTtsProvider, azureTtsFromEnv, hasAzureTtsSecrets, packageName, voiceFor } from './index.ts';

const live = process.env['LECTIO_LIVE'] === '1';
const ENDPOINT = 'https://westeurope.tts.speech.microsoft.com/cognitiveservices/v1';

describe('@lectio/provider-azure-tts', () => {
  it('exports its package name and provider', () => {
    expect(packageName).toBe('@lectio/provider-azure-tts');
    expect(AzureTtsProvider).toBeTypeOf('function');
  });
});

/**
 * Offline: the contract suite against recorded-style responses served by msw. The
 * stand-in audio is derived from the request body, so identical requests give identical bytes.
 */
describe.skipIf(live)('contract (msw)', () => {
  beforeEach(() => {
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        const ssml = new TextEncoder().encode(await request.text());
        const audio = Uint8Array.from({ length: 1200 }, (_, i) => ssml[i % ssml.length] as number);
        return HttpResponse.arrayBuffer(audio.buffer, { headers: { 'Content-Type': 'audio/mpeg' } });
      }),
    );
  });

  describeTtsContract(() => new AzureTtsProvider({ key: 'test-key', region: 'westeurope' }), {
    name: 'azure (msw)',
    voice: voiceFor(DEFAULT_CONFIG, 'en'),
    deterministic: true,
  });
});

/** Live: runs only under `npm run test:live` with real secrets (L-212). */
describe.runIf(live && hasAzureTtsSecrets(process.env))('contract (live)', () => {
  for (const locale of ['en', 'sw']) {
    describeTtsContract(() => azureTtsFromEnv(process.env), {
      name: `azure live ${locale}`,
      voice: voiceFor(DEFAULT_CONFIG, locale),
      timeoutMs: 60_000,
    });
  }
});
