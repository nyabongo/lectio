/**
 * JSON Schema (draft 2020-12 subset understood by ajv) for the merged config.
 * Every object is closed (`additionalProperties: false`) so a misspelt key is
 * an error instead of a silently ignored setting. Rules that span keys live in
 * `validate.ts`.
 */

type Schema = Record<string, unknown>;

const nonEmpty: Schema = { type: 'string', minLength: 1 };
const bool: Schema = { type: 'boolean' };
const nonNegInt: Schema = { type: 'integer', minimum: 0 };
const posInt: Schema = { type: 'integer', minimum: 1 };
const usd: Schema = { type: 'number', minimum: 0 };
const ratio: Schema = { type: 'number', minimum: 0, maximum: 1 };
const locale: Schema = { type: 'string', pattern: '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$' };

function object(properties: Record<string, Schema>, optional: readonly string[] = []): Schema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties).filter((key) => !optional.includes(key)),
    additionalProperties: false,
  };
}

function record(values: Schema, keys: Schema = nonEmpty): Schema {
  return { type: 'object', propertyNames: keys, additionalProperties: values };
}

function oneOf(...values: string[]): Schema {
  return { type: 'string', enum: values };
}

const modelChoice = object({ family: oneOf('anthropic', 'openai', 'google', 'fake'), model: nonEmpty });

export const configSchema: Schema = object({
  site: object({
    baseUrl: { type: 'string', pattern: '^https?://[^\\s]+/$' },
    basePath: { type: 'string', pattern: '^(/[A-Za-z0-9._~-]+)*$' },
    customDomain: { type: 'string', pattern: '^([a-z0-9-]+(\\.[a-z0-9-]+)+)?$' },
    timezone: nonEmpty,
    region: nonEmpty,
    defaultLocale: locale,
    locales: { type: 'array', items: locale, minItems: 1, uniqueItems: true },
    features: object({ listen: bool }),
  }),
  content: object({ root: nonEmpty }),
  linkout: object({
    provider: nonEmpty,
    providers: {
      ...record(
        object(
          {
            label: nonEmpty,
            enabled: bool,
            builtin: oneOf('drbo'),
            template: { type: 'string', pattern: '^https://' },
            versification: nonEmpty,
          },
          ['builtin', 'template', 'versification'],
        ),
        { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
      ),
      minProperties: 1,
    },
    studyText: oneOf('none'),
  }),
  reviewer: object({
    githubHandles: {
      type: 'array',
      items: { type: 'string', pattern: '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$' },
      minItems: 1,
      uniqueItems: true,
    },
    weeklyCapacity: nonNegInt,
    maxOpenReviewPrs: nonNegInt,
    approvalLabel: nonEmpty,
    approvalCommand: { type: 'string', pattern: '^/[a-z][a-z0-9-]*$' },
  }),
  autoMerge: object({
    enabled: bool,
    minSupport: ratio,
    requireBothVerifiers: bool,
    maxRefutations: nonNegInt,
    sensitiveClaimsRequireReview: bool,
    flagsRequireReview: bool,
    passagesOnly: bool,
  }),
  research: object({
    runner: oneOf('local-cli'),
    defaultDays: posInt,
    prGrouping: oneOf('passage'),
    maxRepairs: nonNegInt,
    budget: object({ perPassageUsd: usd, perRunUsd: usd, backfillTotalUsd: usd }),
    models: object({ generator: modelChoice, repair: modelChoice }),
  }),
  runway: object({ windowDays: posInt, maxMissingDays: nonNegInt }),
  verifiers: object({
    confirmer: modelChoice,
    refuter: modelChoice,
    mode: oneOf('auto', 'live', 'fake', 'skip'),
  }),
  tts: object({
    provider: oneOf('fake', 'azure'),
    voices: record(nonEmpty, locale),
    monthlyCharBudget: nonNegInt,
    storage: object({
      provider: oneOf('fs', 's3'),
      publicBaseUrl: { type: 'string', pattern: '^(https?://[^\\s]+/)?$' },
    }),
  }),
  licenceGuard: object({
    maxQuotedWords: posInt,
    maxExcerptWords: posInt,
    maxCommentaryRunWords: posInt,
    maxBibleRunWords: posInt,
    shingleSize: { type: 'integer', minimum: 2 },
  }),
  lectionary: object({
    edition: nonEmpty,
    primarySource: nonEmpty,
    crossCheckSource: nonEmpty,
    provisional: bool,
  }),
  pricing: record(
    object({ inputPerMTok: usd, outputPerMTok: usd, cachedInputPerMTok: usd, webSearchPerThousand: usd }, [
      'cachedInputPerMTok',
      'webSearchPerThousand',
    ]),
  ),
});
