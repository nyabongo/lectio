import { Ajv } from 'ajv';
import type { ErrorObject } from 'ajv';

import { configSchema } from './schema.ts';
import type { LectioConfig, LlmFamily, ModelChoice } from './types.ts';

/** One problem in a config, located by a JSON pointer (RFC 6901) into the file. */
export interface ConfigIssue {
  readonly pointer: string;
  readonly message: string;
}

/** Thrown by `loadConfig` and `validateConfig`; `issues` lists every problem found. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];
  readonly source: string;

  constructor(source: string, issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => `  ${issue.pointer || '/'}: ${issue.message}`);
    super(`Invalid Lectio config (${source}):\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.source = source;
    this.issues = issues;
  }
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validateSchema = ajv.compile(configSchema);

/** Escapes one JSON pointer segment. */
export function pointerSegment(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1');
}

function toIssue(error: ErrorObject): ConfigIssue {
  const { params } = error;
  if (error.keyword === 'additionalProperties') {
    const key = String(params.additionalProperty);
    return { pointer: `${error.instancePath}/${pointerSegment(key)}`, message: 'unknown key' };
  }
  if (error.keyword === 'required') {
    const key = String(params.missingProperty);
    return { pointer: `${error.instancePath}/${pointerSegment(key)}`, message: 'is required' };
  }
  if (error.keyword === 'enum') {
    const allowed = (params.allowedValues as unknown[]).map((value) => JSON.stringify(value)).join(', ');
    return { pointer: error.instancePath, message: `must be one of ${allowed}` };
  }
  if (error.keyword === 'propertyNames') {
    const key = String(params.propertyName);
    return { pointer: `${error.instancePath}/${pointerSegment(key)}`, message: 'invalid key name' };
  }
  return { pointer: error.instancePath, message: String(error.message) };
}

/** Model-id prefixes that reveal the family, so a mislabelled family cannot defeat the independence rule. */
const MODEL_PREFIXES: readonly [RegExp, LlmFamily][] = [
  [/^claude-/, 'anthropic'],
  [/^(gpt-|o[0-9])/, 'openai'],
  [/^gemini-/, 'google'],
];

/** The family a model id belongs to, or `undefined` when the id has no known prefix. */
export function familyOfModel(model: string): LlmFamily | undefined {
  return MODEL_PREFIXES.find(([prefix]) => prefix.test(model))?.[1];
}

/**
 * Why `timezone` cannot be used as the site time zone, or `null`. An unknown zone must fail here:
 * `TZ=<unknown> date` in a workflow silently falls back to UTC and builds the wrong day.
 */
export function timezoneProblem(timezone: string): string | null {
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return `"${timezone}" is not a known IANA time zone (for example "Africa/Nairobi")`;
  }
  if (resolved !== timezone && resolved.toLowerCase() === timezone.toLowerCase()) {
    return `write the time zone as "${resolved}": zone names are case-sensitive outside the JavaScript runtime`;
  }
  return null;
}

/** Rules that span several keys and so cannot be said in the JSON Schema. */
function crossFieldIssues(config: LectioConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const { site, linkout, verifiers, research, pricing, licenceGuard } = config;

  if (verifiers.confirmer.family === verifiers.refuter.family) {
    issues.push({
      pointer: '/verifiers/refuter/family',
      message:
        `confirmer and refuter must come from different model families (both are "${verifiers.refuter.family}"); ` +
        'two independent families are what makes the verification meaningful (L-207)',
    });
  }

  const timezone = timezoneProblem(site.timezone);
  if (timezone !== null) issues.push({ pointer: '/site/timezone', message: timezone });

  if (!site.locales.includes(site.defaultLocale)) {
    issues.push({ pointer: '/site/defaultLocale', message: `"${site.defaultLocale}" is not listed in site.locales` });
  }

  const active = linkout.providers[linkout.provider];
  if (active === undefined) {
    const known = Object.keys(linkout.providers).join(', ');
    issues.push({
      pointer: '/linkout/provider',
      message: `"${linkout.provider}" is not in linkout.providers (${known})`,
    });
  } else if (!active.enabled) {
    issues.push({ pointer: '/linkout/provider', message: `"${linkout.provider}" is disabled; set its enabled: true` });
  }
  for (const [name, provider] of Object.entries(linkout.providers)) {
    if ((provider.builtin === undefined) === (provider.template === undefined)) {
      issues.push({
        pointer: `/linkout/providers/${pointerSegment(name)}`,
        message: 'set exactly one of "builtin" or "template"',
      });
    }
  }

  const models: [string, ModelChoice][] = [
    ['/research/models/generator', research.models.generator],
    ['/research/models/repair', research.models.repair],
    ['/research/models/cheap', research.models.cheap],
    ['/verifiers/confirmer', verifiers.confirmer],
    ['/verifiers/refuter', verifiers.refuter],
  ];
  for (const [pointer, { family, model }] of models) {
    if (!Object.hasOwn(pricing, model)) {
      issues.push({
        pointer: `${pointer}/model`,
        message: `model "${model}" has no entry in pricing, so its cost cannot be metered`,
      });
    }
    const implied = familyOfModel(model);
    if (implied !== undefined && implied !== family) {
      issues.push({
        pointer: `${pointer}/family`,
        message: `"${family}" does not match model "${model}", which belongs to the ${implied} family`,
      });
    }
  }

  if (licenceGuard.maxQuotedWords > licenceGuard.maxExcerptWords) {
    issues.push({ pointer: '/licenceGuard/maxQuotedWords', message: 'must not exceed licenceGuard.maxExcerptWords' });
  }

  return issues;
}

/**
 * Validates a fully merged config. Returns it typed, or throws a `ConfigError`
 * whose issues carry JSON pointers. `source` names the file in the message.
 */
export function validateConfig(candidate: unknown, source = 'built-in defaults'): LectioConfig {
  if (!validateSchema(candidate)) {
    throw new ConfigError(source, (validateSchema.errors as ErrorObject[]).map(toIssue));
  }
  const config = candidate as unknown as LectioConfig;
  const issues = crossFieldIssues(config);
  if (issues.length > 0) throw new ConfigError(source, issues);
  return config;
}
