import type { JsonSchema } from '@lectio/providers';

/**
 * Keywords OpenAI's strict Structured Outputs accept. A schema that uses anything else
 * (for example `minLength`) is rejected by the API in strict mode, so it is sent
 * non-strict and the client validates the answer locally instead.
 */
const STRICT_KEYWORDS: ReadonlySet<string> = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'anyOf',
  '$ref',
  '$defs',
  'definitions',
  'description',
  'title',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function childSchemas(schema: Readonly<Record<string, unknown>>): unknown[] {
  const children: unknown[] = [];
  for (const key of ['properties', '$defs', 'definitions']) {
    const map = schema[key];
    if (isRecord(map)) children.push(...Object.values(map));
  }
  if (schema['items'] !== undefined) children.push(schema['items']);
  const anyOf = schema['anyOf'];
  if (Array.isArray(anyOf)) children.push(...(anyOf as unknown[]));
  return children;
}

/**
 * True when `schema` meets OpenAI's strict-mode rules: only supported keywords, every
 * object closed (`additionalProperties: false`) with all of its properties required,
 * and an object at the root.
 */
export function isStrictCompatible(schema: JsonSchema): boolean {
  if (schema['type'] !== 'object') return false;
  const visit = (node: unknown): boolean => {
    if (!isRecord(node)) return false;
    if (!Object.keys(node).every((key) => STRICT_KEYWORDS.has(key))) return false;
    const properties = node['properties'];
    if (node['type'] === 'object' || properties !== undefined) {
      if (node['additionalProperties'] !== false) return false;
      const keys = isRecord(properties) ? Object.keys(properties) : [];
      const required = Array.isArray(node['required']) ? (node['required'] as unknown[]) : [];
      if (keys.length !== required.length || !keys.every((key) => required.includes(key))) return false;
    }
    return childSchemas(node).every(visit);
  };
  return visit(schema);
}

/**
 * Constraint-only keywords strict mode rejects. Removing them only loosens the schema,
 * and the client still validates the answer against the full schema, so they are
 * dropped from the copy sent to the API instead of giving up strict decoding.
 */
const DROPPABLE_KEYWORDS: ReadonlySet<string> = new Set([
  'minLength',
  'maxLength',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'default',
  'examples',
  '$comment',
  '$schema',
  '$id',
  'deprecated',
  'readOnly',
  'writeOnly',
]);

function strip(node: unknown): unknown {
  if (!isRecord(node)) return node;
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPABLE_KEYWORDS.has(key)) continue;
    if ((key === 'properties' || key === '$defs' || key === 'definitions') && isRecord(value)) {
      copy[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, strip(child)]));
    } else if (key === 'items') {
      copy[key] = strip(value);
    } else if (key === 'anyOf' && Array.isArray(value)) {
      copy[key] = (value as unknown[]).map(strip);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}

/**
 * The schema to send in strict mode: `schema` without the {@link DROPPABLE_KEYWORDS},
 * or `undefined` when even that copy does not meet the strict rules (then the full
 * schema is sent non-strict).
 */
export function toStrictSchema(schema: JsonSchema): JsonSchema | undefined {
  const stripped = strip(schema) as JsonSchema;
  return isStrictCompatible(stripped) ? stripped : undefined;
}
