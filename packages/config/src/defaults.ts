import { deepFreeze } from './merge.ts';
import type { LectioConfig } from './types.ts';

/**
 * Built-in defaults: one value for every owner decision. A config file only
 * needs the keys it changes. `config/README.md` maps each key to its decision
 * issue; keep the two in step.
 *
 * Model ids, tool versions and prices are placeholders that L-039 (Anthropic)
 * and L-040 (OpenAI) confirm; L-041 revisits budgets after the first real run.
 *
 * Deeply frozen so no caller can change the defaults for later `loadConfig()` calls.
 */
export const DEFAULT_CONFIG: LectioConfig = deepFreeze({
  site: {
    baseUrl: 'https://nyabongo.github.io/lectio/',
    basePath: '/lectio',
    customDomain: '',
    timezone: 'Africa/Nairobi',
    region: 'kenya',
    defaultLocale: 'en',
    locales: ['en'],
    features: { listen: false },
  },
  content: { root: '.' },
  linkout: {
    provider: 'drbo',
    providers: {
      drbo: {
        label: 'Douay-Rheims (drbo.org)',
        enabled: true,
        builtin: 'drbo',
        versification: 'vulgate',
      },
      usccb: {
        label: 'New American Bible (USCCB)',
        enabled: false,
        template: 'https://bible.usccb.org/bible/{bookSlug}/{chapter}?{verse}',
      },
      universalis: {
        label: 'Universalis',
        enabled: false,
        template: 'https://universalis.com/{date}/mass.htm',
      },
    },
    studyText: 'none',
  },
  reviewer: {
    githubHandles: ['nyabongo'],
    weeklyCapacity: 15,
    maxOpenReviewPrs: 15,
    approvalLabel: 'approved',
    approvalCommand: '/approve',
  },
  autoMerge: {
    enabled: true,
    minSupport: 0.9,
    requireBothVerifiers: true,
    maxRefutations: 0,
    sensitiveClaimsRequireReview: true,
    flagsRequireReview: true,
    passagesOnly: true,
  },
  research: {
    runner: 'local-cli',
    defaultDays: 14,
    prGrouping: 'passage',
    maxRepairs: 2,
    budget: { perPassageUsd: 1.5, perRunUsd: 25, backfillTotalUsd: 0 },
    models: {
      generator: { family: 'anthropic', model: 'claude-opus-5-5' },
      repair: { family: 'anthropic', model: 'claude-opus-5-5' },
      cheap: { family: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    },
  },
  runway: { windowDays: 21, maxMissingDays: 7 },
  verifiers: {
    confirmer: { family: 'anthropic', model: 'claude-sonnet-5-5' },
    refuter: { family: 'openai', model: 'gpt-5' },
    mode: 'auto',
  },
  tts: {
    provider: 'fake',
    voices: { en: 'en-KE-AsiliaNeural', sw: 'sw-KE-ZuriNeural' },
    monthlyCharBudget: 1_000_000,
    storage: { provider: 'fs', publicBaseUrl: '' },
  },
  licenceGuard: {
    maxQuotedWords: 10,
    maxExcerptWords: 25,
    maxCommentaryRunWords: 12,
    maxBibleRunWords: 12,
    shingleSize: 8,
  },
  lectionary: {
    edition: 'OLM-1981',
    primarySource: 'litcal',
    crossCheckSource: 'olm-1981',
    provisional: true,
  },
  tools: {
    anthropic: { webSearch: 'web_search_20260209', webFetch: 'web_fetch_20260209' },
  },
  pricing: {
    'claude-opus-5-5': { inputPerMTok: 4, outputPerMTok: 20, cachedInputPerMTok: 0.2, webSearchPerThousand: 10 },
    'claude-sonnet-5-5': { inputPerMTok: 2, outputPerMTok: 10, cachedInputPerMTok: 0.2, webSearchPerThousand: 10 },
    'claude-haiku-4-5-20251001': {
      inputPerMTok: 1,
      outputPerMTok: 5,
      cachedInputPerMTok: 0.1,
      webSearchPerThousand: 10,
    },
    'gpt-5': { inputPerMTok: 1.25, outputPerMTok: 10, cachedInputPerMTok: 0.125, webSearchPerThousand: 10 },
    fake: { inputPerMTok: 0, outputPerMTok: 0 },
  },
});
