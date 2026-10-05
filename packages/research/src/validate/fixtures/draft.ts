/**
 * Pre-validation fixtures: a small research output for `MT.20.1-16` that passes gates 1–3 against
 * the repository corpus and inline commentary pages (commentary only, no translation text), the
 * providers to check it with, and a repair client built on the fake LLM.
 */
import { fileURLToPath } from 'node:url';

import { DEFAULT_CONFIG } from '@lectio/config';
import { FakeLlmClient, MemorySourceFetcher, createProviders } from '@lectio/providers';
import type {
  CostMeter,
  FakeLlmScriptEntry,
  LlmClient,
  LlmFamily,
  LlmRequest,
  LlmResponse,
  ProviderSet,
} from '@lectio/providers';

import type { ResearchOutput } from '../../agent/schema.ts';
import type { Draft } from '../validate.ts';

export const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

export const DENARIUS_URL = 'https://commentary.example.org/mt/20-2';
export const EYE_URL = 'https://commentary.example.org/mt/20-15';
export const LAST_URL = 'https://commentary.example.org/mt/20-16';

const page = (text: string): { text: string } => ({ text: `<html><body><p>${text}</p></body></html>` });

export const PAGES = {
  [DENARIUS_URL]: page(
    'In the parable a denarius is the Roman silver coin paid as the usual wage for one day of labour in the field.',
  ),
  [EYE_URL]: page('In Hebrew idiom an evil eye meant a grudging and envious spirit; a good eye meant a generous one.'),
  [LAST_URL]: page('The closing proverb reverses rank: those who came late stand first at the reckoning.'),
};

/** A research output that passes gates 1–3. */
export const VALID_OUTPUT: ResearchOutput = {
  summary: 'A landowner pays every worker the same day’s wage.',
  context: {
    title: 'Labourers in the vineyard',
    paragraphs: [
      'The agreed pay was a denarius, the usual wage for a day. [c1] The owner’s question uses the idiom of the evil eye. [c2]',
    ],
  },
  translationNotes: [
    {
      verse: '20:15',
      anchor: 'envious',
      original: {
        text: 'ὀφθαλμός σου πονηρός',
        lang: 'grc',
        translit: 'ophthalmos sou ponēros',
        gloss: 'your eye evil',
      },
      summary: 'Greek asks whether the eye is evil.',
      body: 'The evil eye was an image for grudging. [c2]',
    },
    {
      verse: '20:2',
      anchor: 'daily wage',
      original: { text: 'δηναρίου', lang: 'grc', translit: 'dēnariou', gloss: 'a denarius' },
      summary: 'Greek names the coin.',
      body: 'A denarius was the usual pay for a day. [c1]',
    },
  ],
  claims: [
    {
      id: 'c1',
      text: 'A denarius was the usual wage for a day’s work.',
      sourceIds: ['mt-20-2', 'commentary-denarius'],
      sensitive: false,
    },
    {
      id: 'c2',
      text: 'An evil eye was an idiom for grudging.',
      sourceIds: ['dt-15-9', 'commentary-eye'],
      sensitive: false,
    },
  ],
  sources: [
    {
      id: 'mt-20-2',
      type: 'scripture',
      citation: 'Matthew 20:2',
      ref: 'Mt 20:2',
      excerpt: 'ἐκ δηναρίου τὴν ἡμέραν',
      excerptLang: 'grc',
    },
    {
      id: 'dt-15-9',
      type: 'scripture',
      citation: 'Deuteronomy 15:9',
      ref: 'Dt 15:9',
      excerpt: 'וְרָעָה עֵינְךָ',
      excerptLang: 'hbo',
    },
    {
      id: 'commentary-denarius',
      type: 'web',
      citation: 'Fixture commentary on Matthew 20:2',
      url: DENARIUS_URL,
      excerpt: 'the Roman silver coin paid as the usual wage',
      excerptLang: 'en',
    },
    {
      id: 'commentary-eye',
      type: 'web',
      citation: 'Fixture commentary on Matthew 20:15',
      url: EYE_URL,
      excerpt: 'an evil eye meant a grudging and envious spirit',
      excerptLang: 'en',
      retrievedAt: '2026-10-05T07:00:00Z',
    },
  ],
};

/** A mutable output for tests to edit. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fixtures are edited freely, the gates judge them
export type EditableOutput = Record<string, any>;

/** A deep copy of {@link VALID_OUTPUT} to edit. */
export function validOutput(): EditableOutput {
  return structuredClone(VALID_OUTPUT) as EditableOutput;
}

/** A draft of `output` from a non-fake generator. */
export function draftOf(output: unknown, costUsd = 0.5): Draft {
  return {
    key: 'MT.20.1-16',
    ref: 'Mt 20:1-16a',
    output,
    meta: {
      locale: 'en',
      runId: 'research-20261005T075000Z',
      models: ['claude-opus-5-5'],
      family: 'anthropic',
      promptVersion: 'research-v1',
      createdAt: '2026-10-05T07:50:00.000Z',
      costUsd,
    },
  };
}

/** The gates' providers: fakes, with the fixture pages behind the fetcher. */
export function fixtureProviders(): ProviderSet {
  return createProviders(DEFAULT_CONFIG, {}, { fetcher: new MemorySourceFetcher(PAGES) });
}

/**
 * The fake LLM answering `repair` calls with `script`, reporting `family`. The fake itself reports
 * `fake`, which the schema gate rightly rejects as provenance, so repair-loop tests pose as the
 * configured family to let a repaired draft pass. With a meter it checks the budget before each
 * call, as the live clients do.
 */
export class RepairLlm implements LlmClient {
  readonly fake: FakeLlmClient;
  readonly family: LlmFamily;
  readonly #meter: CostMeter | undefined;

  constructor(script: FakeLlmScriptEntry, options: { family?: LlmFamily; meter?: CostMeter } = {}) {
    this.fake = new FakeLlmClient({
      roles: { repair: script },
      ...(options.meter === undefined ? {} : { costMeter: options.meter }),
    });
    this.family = options.family ?? 'anthropic';
    this.#meter = options.meter;
  }

  get calls(): readonly LlmRequest[] {
    return this.fake.calls;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    // Like the live clients: refuse to call once the budget is spent, before any charge.
    this.#meter?.assertWithinBudget();
    const response = await this.fake.generate(request);
    return { ...response, family: this.family };
  }
}
