/**
 * A JSON Schema (2020-12) subset for LLM response schemas: generate a valid value (the
 * fake LLM's default answer) and check a value against a schema (the fake and the
 * contract suites). It covers what Lectio's content schemas use:
 *
 * - `type`, `enum`, `const`, `$ref` (local `#/$defs/…`, `#/definitions/…`), `allOf`,
 *   `anyOf`, `oneOf`, `not`, `if` / `then` / `else`;
 * - strings: `minLength`, `maxLength`, `pattern`, `format` (date, date-time, uri, url, email);
 * - numbers: `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`;
 * - arrays: `items`, `minItems`, `maxItems`, `uniqueItems`, `contains`;
 * - objects: `properties`, `required`, `additionalProperties`, `patternProperties`,
 *   `propertyNames`, `minProperties`, `maxProperties`, `dependentRequired`.
 *
 * Validation reports any other keyword as unsupported instead of skipping it.
 *
 * Generation builds candidates and keeps the first one that validates: `examples` and
 * `default` first, then numbers at their upper bound, `false` before `true`, enum values in
 * order, readable `fake …` strings (or a string generated from `pattern`), arrays of one
 * item (then their minimum), objects with every declared property (then only the required
 * ones). Conditionals are applied until the value is stable. When no candidate fits, it
 * throws {@link SchemaGenerationError} naming the field, so the test scripts it instead.
 */
import { generateFromPattern } from './pattern.ts';
import { seededRandom, sha256Hex, stableStringify } from './hash.ts';
import type { JsonSchema } from './llm.ts';

type Schema = Readonly<Record<string, unknown>>;

/** Recursion depth after which optional properties and extra items are left out. */
const MAX_DEPTH = 8;

const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  '$comment',
  '$anchor',
  '$defs',
  'definitions',
  'title',
  'description',
  'examples',
  'default',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

const SUPPORTED = new Set([
  '$ref',
  'type',
  'enum',
  'const',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'contains',
  'properties',
  'required',
  'additionalProperties',
  'patternProperties',
  'propertyNames',
  'minProperties',
  'maxProperties',
  'dependentRequired',
]);

/** No value matching the schema could be generated at `path`. */
export class SchemaGenerationError extends Error {
  override readonly name: string = 'SchemaGenerationError';
  readonly path: string;

  constructor(path: string, message: string) {
    super(`cannot generate ${path}: ${message}; script this output instead`);
    this.path = path;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refTarget(ref: string, root: Schema): Schema {
  const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
  const defs = match ? root[match[1] as string] : undefined;
  const target = match && isRecord(defs) ? defs[match[2] as string] : undefined;
  if (!isRecord(target)) throw new Error(`unsupported or unknown $ref: ${ref}`);
  return target;
}

function without(schema: Schema, ...keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema };
  for (const key of keys) delete out[key];
  return out;
}

function list(schema: Schema, keyword: string): unknown[] {
  const value = schema[keyword];
  return Array.isArray(value) ? value : [];
}

function types(schema: Schema): string[] {
  const type = schema['type'];
  if (typeof type === 'string') return [type];
  return list(schema, 'type').filter((t): t is string => typeof t === 'string');
}

function num(schema: Schema, key: string): number | undefined {
  const value = schema[key];
  return typeof value === 'number' ? value : undefined;
}

const same = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);

const regexCache = new Map<string, RegExp>();
function regex(pattern: string): RegExp {
  let compiled = regexCache.get(pattern);
  if (!compiled) {
    compiled = new RegExp(pattern, 'u');
    regexCache.set(pattern, compiled);
  }
  return compiled;
}

// ---------------------------------------------------------------------------
// Intersection (allOf, conditionals, oneOf branches)

const MAXIMISE = new Set(['minimum', 'exclusiveMinimum', 'minLength', 'minItems', 'minProperties']);
const MINIMISE = new Set(['maximum', 'exclusiveMaximum', 'maxLength', 'maxItems', 'maxProperties']);
const BOTH = new Set(['items', 'contains', 'propertyNames', 'additionalProperties']);

function intersectTypes(a: unknown, b: unknown): string[] {
  const left = types({ type: a });
  const right = types({ type: b });
  const out = new Set<string>();
  for (const t of left) {
    if (right.includes(t)) out.add(t);
    else if (t === 'integer' && right.includes('number')) out.add('integer');
    else if (t === 'number' && right.includes('integer')) out.add('integer');
  }
  return [...out];
}

/**
 * A schema whose instances satisfy both `a` and `b` as far as generation needs: bounds
 * tighten, `required` unions, `type` and `enum` intersect, shared sub-schemas combine
 * with `allOf`. Anything it cannot combine keeps `a`'s value; the final validation
 * against the original schema catches the difference.
 */
export function intersectSchemas(a: Schema, b: Schema): Schema {
  const out: Record<string, unknown> = { ...a };
  for (const [key, right] of Object.entries(b)) {
    const left = out[key];
    if (left === undefined) {
      out[key] = right;
    } else if (MAXIMISE.has(key) && typeof left === 'number' && typeof right === 'number') {
      out[key] = Math.max(left, right);
    } else if (MINIMISE.has(key) && typeof left === 'number' && typeof right === 'number') {
      out[key] = Math.min(left, right);
    } else if (key === 'required') {
      out[key] = [...new Set([...list(a, key), ...list(b, key)])];
    } else if (key === 'type') {
      out[key] = intersectTypes(left, right);
    } else if (key === 'enum') {
      out[key] = list(a, key).filter((x) => list(b, key).some((y) => same(x, y)));
    } else if ((key === 'properties' || key === 'patternProperties') && isRecord(left) && isRecord(right)) {
      const merged: Record<string, unknown> = { ...left };
      for (const [name, sub] of Object.entries(right)) {
        merged[name] = name in merged ? { allOf: [merged[name], sub] } : sub;
      }
      out[key] = merged;
    } else if (BOTH.has(key) && isRecord(left) && isRecord(right)) {
      out[key] = { allOf: [left, right] };
    } else if (key === 'not') {
      out[key] = { anyOf: [left, right] };
    } else if (key === 'uniqueItems') {
      out[key] = left === true || right === true;
    }
  }
  return out;
}

interface Conditional {
  readonly if: unknown;
  readonly then: unknown;
  readonly else: unknown;
}

/** Resolves `$ref`, folds plain `allOf` parts into one schema and collects conditionals. */
function flatten(input: Schema, root: Schema): { base: Schema; conditionals: Conditional[] } {
  let schema: Schema = input;
  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    const target = flatten(refTarget(ref, root), root);
    const rest = flatten(without(schema, '$ref'), root);
    return {
      base: intersectSchemas(target.base, rest.base),
      conditionals: [...target.conditionals, ...rest.conditionals],
    };
  }
  const conditionals: Conditional[] = [];
  if ('if' in schema) conditionals.push({ if: schema['if'], then: schema['then'], else: schema['else'] });
  const parts = list(schema, 'allOf').filter(isRecord);
  schema = without(schema, 'allOf', 'if', 'then', 'else');
  for (const part of parts) {
    const flat = flatten(part, root);
    schema = intersectSchemas(schema, flat.base);
    conditionals.push(...flat.conditionals);
  }
  return { base: schema, conditionals };
}

// ---------------------------------------------------------------------------
// Generation

/**
 * A deterministic value that matches `schema` (validated before it is returned).
 * Different seeds give different strings. Throws {@link SchemaGenerationError} when no
 * candidate fits, for example a `pattern` with constructs the generator does not know.
 */
export function generateFromSchema(schema: JsonSchema, seed = ''): unknown {
  return new Generator(schema, seed).generate(schema, '$', 0);
}

class Generator {
  readonly #root: Schema;
  readonly #seed: string;

  constructor(root: Schema, seed: string) {
    this.#root = root;
    this.#seed = seed;
  }

  #valid(schema: unknown, value: unknown): boolean {
    const errors: string[] = [];
    check(schema, this.#root, value, '$', errors);
    return errors.length === 0;
  }

  generate(input: unknown, path: string, depth: number): unknown {
    if (!isRecord(input)) {
      if (input === false) throw new SchemaGenerationError(path, 'the schema is false');
      return null;
    }
    const { base, conditionals } = flatten(input, this.#root);
    let value = this.#fromCandidates(base, path, depth);
    for (let round = 0; round < 4 && conditionals.length > 0; round++) {
      const branches = conditionals
        .map((c) => (this.#valid(c.if, value) ? c.then : c.else))
        .filter(isRecord)
        .map((branch) => flatten(branch, this.#root).base);
      const next = this.#fromCandidates(branches.reduce(intersectSchemas, base), path, depth);
      const stable = same(next, value);
      value = next;
      if (stable) break;
    }
    const errors: string[] = [];
    check(input, this.#root, value, path, errors);
    if (errors.length > 0) throw new SchemaGenerationError(path, errors.join('; '));
    return value;
  }

  /** The first candidate that validates against `schema`. */
  #fromCandidates(schema: Schema, path: string, depth: number): unknown {
    let lastProblem = 'no candidate';
    for (const make of this.#candidates(schema, path, depth)) {
      let candidate: unknown;
      try {
        candidate = make();
      } catch (error) {
        if (!(error instanceof SchemaGenerationError)) throw error;
        lastProblem = error.message;
        continue;
      }
      const errors: string[] = [];
      check(schema, this.#root, candidate, path, errors);
      if (errors.length === 0) return candidate;
      lastProblem = errors.join('; ');
    }
    throw new SchemaGenerationError(path, `no candidate matches (${lastProblem})`);
  }

  #candidates(schema: Schema, path: string, depth: number): (() => unknown)[] {
    const out: (() => unknown)[] = [];
    for (const example of list(schema, 'examples')) out.push(() => example);
    if ('default' in schema) out.push(() => schema['default']);
    if ('const' in schema) return [...out, () => schema['const']];
    if (Array.isArray(schema['enum'])) return [...out, ...schema['enum'].map((value: unknown) => () => value)];
    for (const keyword of ['oneOf', 'anyOf']) {
      const branches = list(schema, keyword).filter(isRecord);
      if (branches.length > 0) {
        const rest = without(schema, keyword);
        return [
          ...out,
          ...branches.map((branch, i) => () => {
            const others = branches.filter((_, j) => j !== i);
            // oneOf: the value must match this branch and no other.
            const exclusive = keyword === 'oneOf' && others.length > 0 ? { not: { anyOf: others } } : {};
            return this.generate(intersectSchemas(intersectSchemas(rest, branch), exclusive), path, depth);
          }),
        ];
      }
    }
    const declared = types(schema);
    const kinds =
      declared.length > 0
        ? [...declared.filter((t) => t !== 'null'), ...declared.filter((t) => t === 'null')]
        : [inferType(schema)];
    for (const kind of kinds) out.push(...this.#byType(kind, schema, path, depth));
    return out;
  }

  #byType(kind: string, schema: Schema, path: string, depth: number): (() => unknown)[] {
    switch (kind) {
      case 'null':
        return [() => null];
      case 'boolean':
        return [() => false, () => true];
      case 'integer':
      case 'number':
        return numberCandidates(schema, kind === 'integer').map((n) => () => n);
      case 'array':
        return this.#arrayCandidates(schema, path, depth);
      case 'object':
        return this.#objectCandidates(schema, path, depth);
      default:
        return this.#stringCandidates(schema, path);
    }
  }

  #arrayCandidates(schema: Schema, path: string, depth: number): (() => unknown)[] {
    const items = schema['items'] ?? {};
    const min = num(schema, 'minItems') ?? 0;
    const max = num(schema, 'maxItems') ?? Infinity;
    const make = (count: number) => () =>
      Array.from({ length: count }, (_, i) => this.generate(items, `${path}[${i}]`, depth + 1));
    const out = depth >= MAX_DEPTH ? [make(min)] : [make(Math.min(Math.max(min, 1), max)), make(min)];
    const contains = schema['contains'];
    if (isRecord(contains)) {
      out.push(() => [
        this.generate(isRecord(items) ? intersectSchemas(items, contains) : contains, `${path}[0]`, depth + 1),
        ...(make(Math.max(min - 1, 0))() as unknown[]),
      ]);
    }
    return out;
  }

  #objectCandidates(schema: Schema, path: string, depth: number): (() => unknown)[] {
    const properties = isRecord(schema['properties']) ? schema['properties'] : {};
    const required = list(schema, 'required').filter((key): key is string => typeof key === 'string');
    const build = (keys: readonly string[]) => () => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const extra = schema['additionalProperties'];
        const sub = key in properties ? properties[key] : isRecord(extra) ? extra : { const: `fake-${key}` };
        out[key] = this.generate(sub, `${path}.${key}`, depth + 1);
      }
      return out;
    };
    const all = [...new Set([...Object.keys(properties), ...required])];
    return depth >= MAX_DEPTH ? [build(required)] : [build(all), build(required)];
  }

  #stringCandidates(schema: Schema, path: string): (() => unknown)[] {
    const hex = sha256Hex(`${this.#seed}|${path}`).slice(0, 12);
    const out: (() => unknown)[] = [];
    switch (schema['format']) {
      case 'date':
        out.push(() => '2026-01-01');
        break;
      case 'date-time':
        out.push(() => '2026-01-01T00:00:00.000Z');
        break;
      case 'uri':
      case 'url':
        out.push(() => `https://example.org/fake/${hex}`);
        break;
      case 'email':
        out.push(() => `fake-${hex}@example.org`);
        break;
    }
    out.push(() => {
      let value = `fake ${path.replace(/^\$\.?/, '') || 'text'} ${hex}`;
      const minLength = num(schema, 'minLength') ?? 0;
      if (value.length < minLength) value = value.padEnd(minLength, '.');
      return value.slice(0, num(schema, 'maxLength') ?? Infinity);
    });
    const pattern = schema['pattern'];
    if (typeof pattern === 'string') {
      out.push(() => {
        try {
          return generateFromPattern(pattern, seededRandom(`${this.#seed}|${path}`));
        } catch (error) {
          throw new SchemaGenerationError(path, (error as Error).message);
        }
      });
    }
    return out;
  }
}

/** Infers a type for a schema that has none (from its keywords). */
function inferType(schema: Schema): string {
  if (isRecord(schema['properties']) || 'required' in schema) return 'object';
  if ('items' in schema || 'contains' in schema) return 'array';
  if (['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'].some((k) => k in schema)) {
    return 'number';
  }
  return 'string';
}

/** Upper bound first, then lower bound, then 1 and 0; integers round inwards. */
function numberCandidates(schema: Schema, integer: boolean): number[] {
  const step = integer ? 1 : 0.01;
  const min = num(schema, 'minimum');
  const exclusiveMin = num(schema, 'exclusiveMinimum');
  const max = num(schema, 'maximum');
  const exclusiveMax = num(schema, 'exclusiveMaximum');
  const lows: number[] = [];
  const highs: number[] = [];
  if (min !== undefined) lows.push(integer ? Math.ceil(min) : min);
  if (exclusiveMin !== undefined) lows.push(integer ? Math.floor(exclusiveMin) + 1 : exclusiveMin + step);
  if (max !== undefined) highs.push(integer ? Math.floor(max) : max);
  if (exclusiveMax !== undefined) highs.push(integer ? Math.ceil(exclusiveMax) - 1 : exclusiveMax - step);
  const low = lows.length > 0 ? Math.max(...lows) : undefined;
  const high = highs.length > 0 ? Math.min(...highs) : undefined;
  const out: number[] = [];
  if (high !== undefined) out.push(high);
  if (low !== undefined) out.push(low);
  if (low !== undefined && high !== undefined) out.push(integer ? Math.ceil((low + high) / 2) : (low + high) / 2);
  const multipleOf = num(schema, 'multipleOf');
  if (multipleOf !== undefined) {
    out.push(Math.floor((high ?? multipleOf) / multipleOf) * multipleOf);
    out.push(Math.ceil((low ?? 0) / multipleOf) * multipleOf);
  }
  out.push(1, 0);
  if (!integer) out.push(0.5);
  return out;
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

/** `YYYY-MM-DD` that names a real day (no rollover such as 2026-02-30). */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/i;

const FORMATS: Readonly<Record<string, (value: string) => boolean>> = {
  date: isRealDate,
  'date-time': (v) => isRealDate(DATE_TIME.exec(v)?.[1] ?? ''),
  uri: (v) => URL.canParse(v),
  url: (v) => URL.canParse(v),
  email: (v) => /^[^@\s]+@[^@\s]+$/.test(v),
};

function matches(schema: unknown, root: Schema, value: unknown): boolean {
  const errors: string[] = [];
  check(schema, root, value, '$', errors);
  return errors.length === 0;
}

function check(input: unknown, root: Schema, value: unknown, path: string, errors: string[]): void {
  if (input === false) {
    errors.push(`${path}: no value is allowed here`);
    return;
  }
  if (!isRecord(input)) return;
  let schema: Schema = input;
  const ref = schema['$ref'];
  if (typeof ref === 'string') {
    check(refTarget(ref, root), root, value, path, errors);
    schema = without(schema, '$ref');
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key) && !ANNOTATIONS.has(key)) errors.push(`${path}: unsupported keyword "${key}"`);
  }
  if ('const' in schema && !same(schema['const'], value)) {
    errors.push(`${path}: must equal ${JSON.stringify(schema['const'])}`);
  }
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues) && !enumValues.some((e) => same(e, value))) {
    errors.push(`${path}: must be one of ${JSON.stringify(enumValues)}`);
  }
  for (const part of list(schema, 'allOf')) check(part, root, value, path, errors);
  const anyOf = list(schema, 'anyOf');
  if (anyOf.length > 0 && !anyOf.some((s) => matches(s, root, value))) {
    errors.push(`${path}: must match a schema in anyOf`);
  }
  const oneOf = list(schema, 'oneOf');
  if (oneOf.length > 0 && oneOf.filter((s) => matches(s, root, value)).length !== 1) {
    errors.push(`${path}: must match exactly one schema in oneOf`);
  }
  if ('not' in schema && matches(schema['not'], root, value)) errors.push(`${path}: must not match "not"`);
  if ('if' in schema) {
    const branch = matches(schema['if'], root, value) ? schema['then'] : schema['else'];
    check(branch, root, value, path, errors);
  }
  const expected = types(schema);
  const actual = typeOf(value);
  if (expected.length > 0 && !expected.some((t) => matchesType(t, actual))) {
    errors.push(`${path}: must be ${expected.join(' or ')}, got ${actual}`);
    return;
  }
  if (typeof value === 'string') checkString(schema, value, path, errors);
  else if (typeof value === 'number') checkNumber(schema, value, path, errors);
  else if (Array.isArray(value)) checkArray(schema, root, value, path, errors);
  else if (isRecord(value)) checkObject(schema, root, value, path, errors);
}

function checkString(schema: Schema, value: string, path: string, errors: string[]): void {
  const length = [...value].length;
  const minLength = num(schema, 'minLength');
  const maxLength = num(schema, 'maxLength');
  if (minLength !== undefined && length < minLength) errors.push(`${path}: shorter than ${minLength}`);
  if (maxLength !== undefined && length > maxLength) errors.push(`${path}: longer than ${maxLength}`);
  const pattern = schema['pattern'];
  if (typeof pattern === 'string' && !regex(pattern).test(value)) errors.push(`${path}: does not match /${pattern}/`);
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
    ['multipleOf', (limit) => Math.abs(value / limit - Math.round(value / limit)) < 1e-9],
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
  if ('items' in schema) value.forEach((item, i) => check(schema['items'], root, item, `${path}[${i}]`, errors));
  if (schema['uniqueItems'] === true && new Set(value.map((item) => stableStringify(item))).size !== value.length) {
    errors.push(`${path}: items must be unique`);
  }
  if ('contains' in schema && !value.some((item) => matches(schema['contains'], root, item))) {
    errors.push(`${path}: must contain a matching item`);
  }
}

function checkObject(
  schema: Schema,
  root: Schema,
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const patternProperties = isRecord(schema['patternProperties']) ? schema['patternProperties'] : {};
  const keys = Object.keys(value);
  for (const key of list(schema, 'required')) {
    if (typeof key === 'string' && !(key in value)) errors.push(`${path}: missing required property "${key}"`);
  }
  const minProperties = num(schema, 'minProperties');
  const maxProperties = num(schema, 'maxProperties');
  if (minProperties !== undefined && keys.length < minProperties)
    errors.push(`${path}: fewer than ${minProperties} properties`);
  if (maxProperties !== undefined && keys.length > maxProperties)
    errors.push(`${path}: more than ${maxProperties} properties`);
  const dependentRequired = isRecord(schema['dependentRequired']) ? schema['dependentRequired'] : {};
  for (const [key, needs] of Object.entries(dependentRequired)) {
    if (!(key in value) || !Array.isArray(needs)) continue;
    for (const need of needs) {
      if (typeof need === 'string' && !(need in value)) errors.push(`${path}: "${key}" requires "${need}"`);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    const itemPath = `${path}.${key}`;
    if ('propertyNames' in schema && !matches(schema['propertyNames'], root, key)) {
      errors.push(`${path}: property name "${key}" is not allowed`);
    }
    let known = key in properties;
    if (known) check(properties[key], root, item, itemPath, errors);
    for (const [pattern, sub] of Object.entries(patternProperties)) {
      if (!regex(pattern).test(key)) continue;
      known = true;
      check(sub, root, item, itemPath, errors);
    }
    if (known || !('additionalProperties' in schema)) continue;
    if (schema['additionalProperties'] === false) errors.push(`${path}: unexpected property "${key}"`);
    else check(schema['additionalProperties'], root, item, itemPath, errors);
  }
}
