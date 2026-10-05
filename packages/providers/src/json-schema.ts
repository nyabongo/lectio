/**
 * A small JSON Schema subset, enough for LLM response schemas: generate a valid
 * value (the fake LLM's default answer) and check a value against a schema (the
 * contract suites). Supported keywords: `type` (string or array), `enum`, `const`,
 * `properties`, `required`, `additionalProperties: false`, `items`, `minItems`,
 * `maxItems`, `minLength`, `maxLength`, `format` (date, date-time, uri, email),
 * `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `anyOf`, `oneOf`,
 * `allOf` and local `$ref` (`#/$defs/...`, `#/definitions/...`). Other keywords
 * (such as `pattern`) are ignored.
 *
 * Generated values are deterministic for a given seed and lean "clean": numbers take
 * their maximum, booleans are false, enums take their first value. That makes the
 * fake's default output confident and unflagged; tests patch it to script refutations,
 * low confidence or sensitive flags.
 */
import { sha256Hex } from './hash.ts';
import type { JsonSchema } from './llm.ts';

type Schema = Readonly<Record<string, unknown>>;

/** Recursion depth after which optional properties and extra items are left out. */
const MAX_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolve(schema: Schema, root: Schema): Schema {
  const ref = schema['$ref'];
  if (typeof ref !== 'string') return schema;
  const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
  const defs = match ? root[match[1] as string] : undefined;
  const target = match && isRecord(defs) ? defs[match[2] as string] : undefined;
  if (!isRecord(target)) throw new Error(`unsupported or unknown $ref: ${ref}`);
  return resolve(target, root);
}

function subschemas(schema: Schema, keyword: 'anyOf' | 'oneOf' | 'allOf'): Schema[] {
  const list = schema[keyword];
  return Array.isArray(list) ? list.filter(isRecord) : [];
}

function types(schema: Schema): string[] {
  const type = schema['type'];
  if (typeof type === 'string') return [type];
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === 'string') : [];
}

function num(schema: Schema, key: string): number | undefined {
  const value = schema[key];
  return typeof value === 'number' ? value : undefined;
}

/** Infers a type for a schema that has none (from its keywords). */
function inferType(schema: Schema): string {
  if (isRecord(schema['properties'])) return 'object';
  if (schema['items'] !== undefined) return 'array';
  return 'string';
}

// ---------------------------------------------------------------------------
// Generation

/** A deterministic value that matches `schema`. Different seeds give different strings. */
export function generateFromSchema(schema: JsonSchema, seed = ''): unknown {
  return generate(schema, schema, seed, '$', 0);
}

function generate(input: Schema, root: Schema, seed: string, path: string, depth: number): unknown {
  const schema = resolve(input, root);
  if ('const' in schema) return schema['const'];
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && enumValues.length > 0) return enumValues[0];
  const allOf = subschemas(schema, 'allOf');
  if (allOf.length > 0) {
    const merged: Record<string, unknown> = { ...schema };
    delete merged['allOf'];
    const properties: Record<string, unknown> = isRecord(schema['properties']) ? { ...schema['properties'] } : {};
    const required = new Set<unknown>(Array.isArray(schema['required']) ? schema['required'] : []);
    for (const part of allOf.map((s) => resolve(s, root))) {
      Object.assign(merged, part);
      if (isRecord(part['properties'])) Object.assign(properties, part['properties']);
      if (Array.isArray(part['required'])) for (const key of part['required']) required.add(key);
    }
    return generate({ ...merged, properties, required: [...required] }, root, seed, path, depth);
  }
  const choice = subschemas(schema, 'anyOf')[0] ?? subschemas(schema, 'oneOf')[0];
  if (choice) return generate(choice, root, seed, path, depth);

  const type = types(schema).find((t) => t !== 'null') ?? types(schema)[0] ?? inferType(schema);
  switch (type) {
    case 'null':
      return null;
    case 'boolean':
      return false;
    case 'integer':
    case 'number':
      return generateNumber(schema, type === 'integer');
    case 'array':
      return generateArray(schema, root, seed, path, depth);
    case 'object':
      return generateObject(schema, root, seed, path, depth);
    default:
      return generateString(schema, seed, path);
  }
}

function generateNumber(schema: Schema, integer: boolean): number {
  const max = num(schema, 'maximum');
  const exclusiveMax = num(schema, 'exclusiveMaximum');
  const min = num(schema, 'minimum');
  const exclusiveMin = num(schema, 'exclusiveMinimum');
  const step = integer ? 1 : 0.01;
  let value: number;
  if (max !== undefined) value = max;
  else if (exclusiveMax !== undefined) value = exclusiveMax - step;
  else if (min !== undefined) value = min;
  else if (exclusiveMin !== undefined) value = exclusiveMin + step;
  else value = 1;
  return integer ? Math.floor(value) : value;
}

function generateArray(schema: Schema, root: Schema, seed: string, path: string, depth: number): unknown[] {
  const items = isRecord(schema['items']) ? schema['items'] : {};
  const min = num(schema, 'minItems') ?? 0;
  const max = num(schema, 'maxItems') ?? Infinity;
  const count = depth >= MAX_DEPTH ? min : Math.min(Math.max(min, 1), max);
  return Array.from({ length: count }, (_, i) => generate(items, root, seed, `${path}[${i}]`, depth + 1));
}

function generateObject(
  schema: Schema,
  root: Schema,
  seed: string,
  path: string,
  depth: number,
): Record<string, unknown> {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : []);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isRecord(value) || (depth >= MAX_DEPTH && !required.has(key))) continue;
    out[key] = generate(value, root, seed, `${path}.${key}`, depth + 1);
  }
  for (const key of required) {
    if (typeof key === 'string' && !(key in out)) out[key] = `fake-${key}`;
  }
  return out;
}

function generateString(schema: Schema, seed: string, path: string): string {
  const hex = sha256Hex(`${seed}|${path}`).slice(0, 12);
  let value: string;
  switch (schema['format']) {
    case 'date':
      return '2026-01-01';
    case 'date-time':
      return '2026-01-01T00:00:00.000Z';
    case 'uri':
    case 'url':
      return `https://example.org/fake/${hex}`;
    case 'email':
      return `fake-${hex}@example.org`;
    default:
      value = `fake ${path.replace(/^\$\.?/, '') || 'text'} ${hex}`;
  }
  const minLength = num(schema, 'minLength') ?? 0;
  const maxLength = num(schema, 'maxLength') ?? Infinity;
  if (value.length < minLength) value = value.padEnd(minLength, '.');
  return value.slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Validation

/** Problems with `value` against `schema` (empty when it matches), as `path: message`. */
export function validateAgainstSchema(schema: JsonSchema, value: unknown): string[] {
  const errors: string[] = [];
  check(schema, schema, value, '$', errors);
  return errors;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(expected: string, actual: string): boolean {
  return expected === actual || (expected === 'number' && actual === 'integer');
}

const FORMATS: Readonly<Record<string, (value: string) => boolean>> = {
  date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)),
  'date-time': (v) => /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)),
  uri: (v) => URL.canParse(v),
  url: (v) => URL.canParse(v),
  email: (v) => /^[^@\s]+@[^@\s]+$/.test(v),
};

function check(input: Schema, root: Schema, value: unknown, path: string, errors: string[]): void {
  const schema = resolve(input, root);
  const actual = typeOf(value);
  if ('const' in schema && JSON.stringify(schema['const']) !== JSON.stringify(value)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema['const'])}`);
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${path}: must be one of ${JSON.stringify(enumValues)}`);
  }
  for (const part of subschemas(schema, 'allOf')) check(part, root, value, path, errors);
  const anyOf = subschemas(schema, 'anyOf');
  if (anyOf.length > 0 && !anyOf.some((s) => validateAgainstSchemaAt(s, root, value))) {
    errors.push(`${path}: must match a schema in anyOf`);
  }
  const oneOf = subschemas(schema, 'oneOf');
  if (oneOf.length > 0 && oneOf.filter((s) => validateAgainstSchemaAt(s, root, value)).length !== 1) {
    errors.push(`${path}: must match exactly one schema in oneOf`);
  }
  const expected = types(schema);
  if (expected.length > 0 && !expected.some((t) => matchesType(t, actual))) {
    errors.push(`${path}: must be ${expected.join(' or ')}, got ${actual}`);
    return;
  }
  if (typeof value === 'string') checkString(schema, value, path, errors);
  else if (typeof value === 'number') checkNumber(schema, value, path, errors);
  else if (Array.isArray(value)) checkArray(schema, root, value, path, errors);
  else if (isRecord(value)) checkObject(schema, root, value, path, errors);
}

function validateAgainstSchemaAt(schema: Schema, root: Schema, value: unknown): boolean {
  const errors: string[] = [];
  check(schema, root, value, '$', errors);
  return errors.length === 0;
}

function checkString(schema: Schema, value: string, path: string, errors: string[]): void {
  const minLength = num(schema, 'minLength');
  const maxLength = num(schema, 'maxLength');
  if (minLength !== undefined && value.length < minLength) errors.push(`${path}: shorter than ${minLength}`);
  if (maxLength !== undefined && value.length > maxLength) errors.push(`${path}: longer than ${maxLength}`);
  const format = schema['format'];
  const test = typeof format === 'string' ? FORMATS[format] : undefined;
  if (test && !test(value)) errors.push(`${path}: not a valid ${String(format)}`);
}

function checkNumber(schema: Schema, value: number, path: string, errors: string[]): void {
  const bounds: [string, (limit: number) => boolean][] = [
    ['minimum', (limit) => value >= limit],
    ['maximum', (limit) => value <= limit],
    ['exclusiveMinimum', (limit) => value > limit],
    ['exclusiveMaximum', (limit) => value < limit],
  ];
  for (const [key, ok] of bounds) {
    const limit = num(schema, key);
    if (limit !== undefined && !ok(limit)) errors.push(`${path}: violates ${key} ${limit}`);
  }
}

function checkArray(schema: Schema, root: Schema, value: unknown[], path: string, errors: string[]): void {
  const minItems = num(schema, 'minItems');
  const maxItems = num(schema, 'maxItems');
  if (minItems !== undefined && value.length < minItems) errors.push(`${path}: fewer than ${minItems} items`);
  if (maxItems !== undefined && value.length > maxItems) errors.push(`${path}: more than ${maxItems} items`);
  const items = schema['items'];
  if (isRecord(items)) value.forEach((item, i) => check(items, root, item, `${path}[${i}]`, errors));
}

function checkObject(
  schema: Schema,
  root: Schema,
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = Array.isArray(schema['required']) ? schema['required'] : [];
  for (const key of required) {
    if (typeof key === 'string' && !(key in value)) errors.push(`${path}: missing required property "${key}"`);
  }
  for (const [key, item] of Object.entries(value)) {
    const sub = properties[key];
    if (isRecord(sub)) check(sub, root, item, `${path}.${key}`, errors);
    else if (schema['additionalProperties'] === false) errors.push(`${path}: unexpected property "${key}"`);
  }
}
