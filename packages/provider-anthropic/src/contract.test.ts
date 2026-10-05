import { DEFAULT_CONFIG } from '@lectio/config';
import { describeLlmContract } from '@lectio/providers/contracts';
import { server } from '@lectio/shared/test-server';
import { http } from 'msw';
import { beforeEach, describe } from 'vitest';

import { AnthropicLlmClient } from './client.ts';
import { BASE_URL, MESSAGES_URL, loadRecorded, sseResponse } from './fixtures/recorded.ts';

const live = process.env['LECTIO_LIVE'] === '1';
const liveKey = process.env['ANTHROPIC_API_KEY'];

// Offline: the contract suite against recorded responses, routed by what the request asks for.
if (!live) {
  beforeEach(() => {
    server.use(
      http.post(MESSAGES_URL, async ({ request }) => {
        const body = (await request.json()) as { tools?: unknown[]; output_config?: { format?: unknown } };
        if (body.tools && body.tools.length > 0) return sseResponse(loadRecorded('web-tools'));
        if (body.output_config?.format) return sseResponse(loadRecorded('json'));
        return sseResponse(loadRecorded('text'));
      }),
    );
  });
}

describe.skipIf(live)('offline', () => {
  describeLlmContract(
    (costMeter) =>
      new AnthropicLlmClient({
        costMeter,
        apiKey: 'test-key',
        baseURL: BASE_URL,
        tools: DEFAULT_CONFIG.tools.anthropic,
        sleep: () => Promise.resolve(),
      }),
    { name: 'anthropic (recorded)', model: 'claude-sonnet-5-5', deterministic: true },
  );
});

// Live: the same suite against the real API, only under `npm run test:live` with a key (L-212).
describe.runIf(live && liveKey !== undefined && liveKey.length > 0)('live', () => {
  describeLlmContract(
    (costMeter) => new AnthropicLlmClient({ costMeter, apiKey: liveKey ?? '', tools: DEFAULT_CONFIG.tools.anthropic }),
    { name: 'anthropic (live)', model: DEFAULT_CONFIG.verifiers.confirmer.model, timeoutMs: 300_000 },
  );
});
