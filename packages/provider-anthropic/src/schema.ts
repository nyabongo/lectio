/**
 * Converts a Lectio response schema (JSON Schema 2020-12 subset, see `@lectio/providers`
 * `json-schema.ts`) into the subset Anthropic structured outputs accept.
 *
 * Structured outputs reject numeric bounds, string lengths, `maxItems`, `minItems` above 1,
 * conditionals, most object keywords and regex features beyond simple patterns, and require `additionalProperties: false`
 * on every object. Following the SDK helpers, each unsupported keyword is removed and
 * written into the field's `description` (for example `{minimum: 0, maximum: 1}`) so the
 * model still sees it; the client then validates the parsed answer against the original
 * schema and retries on a mismatch.
 */
import type { JsonSchema } from '@lectio/providers';

type Schema = Record<string, unknown>;

/** Supported `format` values (Anthropic structured outputs). */
const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** Annotations that carry no constraint and are dropped. */
const DROPPED = new Set([
  '$schema',
  '$id',
  '$comment',
  '$anchor',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

/** Keywords copied unchanged. */
const KEPT = new Set(['type', 'enum', 'const', 'title', 'required']);

/**
 * Regex features structured outputs do not support in `pattern`: lookaround, backreferences
 * (numbered and named) and word boundaries.
 */
const UNSUPPORTED_PATTERN = /\(\?<?[=!]|\\[1-9]|\\k<|\\[bB]/;

/** True when `pattern` can be sent as is (a simple regex); otherwise it moves into the description. */
export function isSupportedPattern(pattern: string): boolean {
  return !UNSUPPORTED_PATTERN.test(pattern);
}

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectSchema(schema: Schema): boolean {
  const { type } = schema;
  if (type === 'object') return true;
  if (Array.isArray(type)) return type.includes('object');
  return type === undefined && isSchema(schema['properties']);
}

function rewriteRef(ref: unknown): unknown {
  return typeof ref === 'string' ? ref.replace(/^#\/definitions\//, '#/$defs/') : ref;
}

function transformMap(value: unknown): Schema {
  const out: Schema = {};
  if (isSchema(value)) for (const [key, sub] of Object.entries(value)) out[key] = transform(sub);
  return out;
}

function transform(input: unknown): unknown {
  if (!isSchema(input)) return input;
  const out: Schema = {};
  const notes: [string, unknown][] = [];
  const defs: Schema = {};

  for (const [key, value] of Object.entries(input)) {
    if (DROPPED.has(key) || key === 'description' || key === 'additionalProperties') continue;
    if (KEPT.has(key)) out[key] = value;
    else if (key === '$ref') out[key] = rewriteRef(value);
    else if (key === '$defs' || key === 'definitions') Object.assign(defs, transformMap(value));
    else if (key === 'properties') out[key] = transformMap(value);
    else if (key === 'items' && isSchema(value)) out[key] = transform(value);
    else if ((key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)) {
      const target = key === 'allOf' ? 'allOf' : 'anyOf';
      const existing = (out[target] as unknown[] | undefined) ?? [];
      out[target] = [...existing, ...value.map(transform)];
    } else if (key === 'format' && typeof value === 'string' && SUPPORTED_FORMATS.has(value)) out[key] = value;
    else if (key === 'minItems' && (value === 0 || value === 1)) out[key] = value;
    else if (key === 'pattern' && typeof value === 'string' && isSupportedPattern(value)) out[key] = value;
    else notes.push([key, value]);
  }

  if (Object.keys(defs).length > 0) out['$defs'] = defs;
  if (isObjectSchema(input)) {
    const extra = input['additionalProperties'];
    if (extra !== undefined && extra !== false) notes.push(['additionalProperties', extra]);
    out['additionalProperties'] = false;
  }

  const description = typeof input['description'] === 'string' ? input['description'] : undefined;
  const note =
    notes.length > 0 ? `{${notes.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ')}}` : undefined;
  const text = [description, note].filter((part) => part !== undefined).join('\n\n');
  if (text.length > 0) out['description'] = text;
  return out;
}

/** The structured-output form of `schema`. The input is not modified. */
export function toStructuredOutputSchema(schema: JsonSchema): Record<string, unknown> {
  return transform(schema) as Record<string, unknown>;
}
