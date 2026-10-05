/**
 * The fake translation LLM: a `FakeLlmClient` whose generator answers with a deterministic
 * pseudo-translation of the passage it is given. Every sentence becomes a fixed Swahili
 * placeholder that keeps the English sentence's claim markers, so ids and markers line up exactly
 * as a real translation must. Built at test time from the English file; no translation is stored.
 */
import { DEFAULT_CONFIG } from '@lectio/config';
import { FakeLlmClient, llmPromptKey } from '@lectio/providers';
import type { CostMeter, FakeLlmScript, LlmUsage } from '@lectio/providers';
import type { Passage } from '@lectio/schema/passage';

import { buildTranslateRequest } from '../translate.ts';
import type { TranslateOutput } from '../translate.ts';

/** About what one translation costs on the default generator. */
export const TRANSLATE_USAGE_FIXTURE: LlmUsage = {
  inputTokens: 6_000,
  outputTokens: 4_000,
  cachedInputTokens: 0,
  webSearches: 0,
};

/** Each run of prose before a marker group becomes one placeholder sentence; the markers stay. */
export function pseudoCited(text: string): string {
  return text
    .replace(/[^[\]]+((?:\[c[0-9]+\])+)/g, (_match, markers: string) => `Sentensi iliyotafsiriwa. ${markers} `)
    .trim();
}

/** A pseudo-translation of every translatable field of `passage`. */
export function pseudoTranslation(passage: Passage): TranslateOutput {
  return {
    summary: `Muhtasari wa ${passage.key}.`,
    context: { title: 'Kichwa cha habari', paragraphs: passage.context.paragraphs.map(pseudoCited) },
    translationNotes: passage.translationNotes.map((note) => ({
      id: note.id,
      gloss: 'maana ya maneno asilia',
      summary: 'Muhtasari wa maelezo.',
      body: pseudoCited(note.body),
    })),
    claims: passage.claims.map((claim) => ({ id: claim.id, text: `Dai ${claim.id}.` })),
  };
}

/**
 * A client factory for `TranslateDeps.llm`: the generator answers each passage of `passages` with
 * its pseudo-translation (scripted by prompt), and any other prompt with `fallback`.
 */
export function fakeTranslateLlm(
  options: { readonly passages?: readonly Passage[]; readonly locale?: string; readonly fallback?: FakeLlmScript } = {},
): ((meter: CostMeter) => FakeLlmClient) & { readonly clients: FakeLlmClient[] } {
  const locale = options.locale ?? 'sw';
  const scripts = Object.fromEntries(
    (options.passages ?? []).map((passage) => {
      const request = buildTranslateRequest(passage, { config: DEFAULT_CONFIG, locale });
      return [llmPromptKey(request), { output: pseudoTranslation(passage), usage: TRANSLATE_USAGE_FIXTURE }];
    }),
  );
  const clients: FakeLlmClient[] = [];
  const factory = (meter: CostMeter): FakeLlmClient => {
    const client = new FakeLlmClient({
      costMeter: meter,
      scripts,
      ...(options.fallback === undefined ? {} : { roles: { generator: options.fallback } }),
    });
    clients.push(client);
    return client;
  };
  return Object.assign(factory, { clients });
}
