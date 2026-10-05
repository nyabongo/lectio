import { DEFAULT_CONFIG } from '@lectio/config';
import { describeLlmContract } from '@lectio/providers/contracts';
import { server } from '@lectio/shared/test-server';
import { beforeEach, describe } from 'vitest';

import { OpenAiLlmClient } from './client.ts';
import { OPENAI_API_KEY_ENV } from './create.ts';
import { recordedHandler } from './fixtures/recorded.ts';

const model = DEFAULT_CONFIG.verifiers.refuter.model;

describe('OpenAiLlmClient against recorded HTTP', () => {
  beforeEach(() => {
    server.use(recordedHandler());
  });

  describeLlmContract((costMeter) => new OpenAiLlmClient({ apiKey: 'sk-test-offline', costMeter, maxRetries: 0 }), {
    name: 'openai (recorded)',
    model,
    deterministic: true,
  });
});

// The live run (L-212): `LECTIO_LIVE=1 OPENAI_API_KEY=... npm run test:live`. Never part of CI.
const liveKey = process.env['LECTIO_LIVE'] === '1' ? process.env[OPENAI_API_KEY_ENV] : undefined;

describe.runIf(liveKey !== undefined && liveKey.length > 0)('OpenAiLlmClient against the live API', () => {
  describeLlmContract((costMeter) => new OpenAiLlmClient({ apiKey: liveKey as string, costMeter }), {
    name: 'openai (live)',
    model,
    timeoutMs: 120_000,
  });
});
