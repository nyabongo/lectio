import { Ajv } from 'ajv';
import type { ErrorObject } from 'ajv';

import { configSchema } from './schema.ts';
import type { LectioConfig } from './types.ts';

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

  const models: [string, string][] = [
    ['/research/models/generator/model', research.models.generator.model],
    ['/research/models/repair/model', research.models.repair.model],
    ['/verifiers/confirmer/model', verifiers.confirmer.model],
    ['/verifiers/refuter/model', verifiers.refuter.model],
  ];
  for (const [pointer, model] of models) {
    if (!Object.hasOwn(pricing, model)) {
      issues.push({ pointer, message: `model "${model}" has no entry in pricing, so its cost cannot be metered` });
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
