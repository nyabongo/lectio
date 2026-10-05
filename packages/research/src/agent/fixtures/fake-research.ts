/**
 * The fake research LLM: a `FakeLlmClient` whose generator answers with a realistic
 * Mt 20:1-16-style research output (commentary, Greek words checked against the corpus,
 * short verbatim excerpts, sensitive claims flagged; no translation text) and a realistic
 * token and search usage, so cost metering behaves as in a live run.
 */
import { readFileSync } from 'node:fs';

import { FakeLlmClient } from '@lectio/providers';
import type { CostMeter, FakeLlmScript, LlmUsage } from '@lectio/providers';

import type { ResearchOutput } from '../schema.ts';

/** The research output for `MT.20.1-16` (from the seeded passage, ids and provenance removed). */
export const MT_20_OUTPUT = JSON.parse(
  readFileSync(new URL('./mt-20-1-16.output.json', import.meta.url), 'utf8'),
) as ResearchOutput;

/** About what one passage costs on the default generator: $0.50 at `claude-opus-5-5` prices. */
export const MT_20_USAGE: LlmUsage = { inputTokens: 60_000, outputTokens: 9_000, cachedInputTokens: 0, webSearches: 8 };

export const MT_20_CITATIONS = [
  { url: 'https://biblehub.com/commentaries/matthew/20-15.htm', title: 'Matthew 20:15 Commentaries' },
  { url: 'https://biblehub.com/greek/18.htm', title: 'Strong’s Greek: 18. ἀγαθός' },
] as const;

/** A client factory for `ResearchDeps.llm`: every generator call answers with `script` (default the Mt 20 output). */
export function fakeResearchLlm(
  script: FakeLlmScript = { output: MT_20_OUTPUT, usage: MT_20_USAGE, citations: MT_20_CITATIONS },
): ((meter: CostMeter) => FakeLlmClient) & { readonly clients: FakeLlmClient[] } {
  const clients: FakeLlmClient[] = [];
  const factory = (meter: CostMeter): FakeLlmClient => {
    const client = new FakeLlmClient({ costMeter: meter, roles: { generator: script } });
    clients.push(client);
    return client;
  };
  return Object.assign(factory, { clients });
}
