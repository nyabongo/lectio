/**
 * Gate result schema: what one content gate (schema, evidence, licence guard, verifiers,
 * merge rule; L-023–L-031) reports about a pull request. Each item names a rule, a file and a
 * JSON pointer into it, so a PR comment can point at the exact claim or field.
 *
 * Status and items must agree: `pass` has no `error` item, `fail` has at least one, `flag`
 * has at least one item of any severity.
 */
import type { FromSchema } from 'json-schema-to-ts';

import {
  CLAIM_ID_PATTERN,
  JSON_SCHEMA_DIALECT,
  createAjv,
  nonEmptyStringSchema,
  schemaId,
  slugSchema,
} from '../common/index.ts';

export const GATE_STATUSES = ['pass', 'fail', 'flag', 'skipped'] as const;
export const SEVERITIES = ['error', 'warning', 'info'] as const;

/** A rule id: dotted kebab-case segments, e.g. `passage.no-reading-text` or `evidence.excerpt-found`. */
export const RULE_ID_PATTERN = '^[a-z0-9]+(-[a-z0-9]+)*(\\.[a-z0-9]+(-[a-z0-9]+)*)*$';

/** An RFC 6901 JSON pointer; `""` points at the whole document. */
export const JSON_POINTER_PATTERN = '^(/([^~/]|~[01])*)*$';

const itemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ruleId', 'severity', 'file', 'pointer', 'message'],
  properties: {
    ruleId: { type: 'string', pattern: RULE_ID_PATTERN },
    severity: { type: 'string', enum: SEVERITIES },
    /** Repository-relative path with forward slashes, e.g. `passages/MT.20.1-16.json`. */
    file: { type: 'string', pattern: '^[^/\\\\].*$' },
    pointer: { type: 'string', pattern: JSON_POINTER_PATTERN },
    claimId: { type: 'string', pattern: CLAIM_ID_PATTERN },
    message: nonEmptyStringSchema,
  },
} as const;

const hasError = {
  type: 'array',
  contains: { type: 'object', properties: { severity: { const: 'error' } } },
} as const;

export const gateResultSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('gate-result'),
  title: 'Lectio gate result',
  description: 'The outcome of one content gate on a pull request, with one item per finding.',
  type: 'object',
  additionalProperties: false,
  required: ['gate', 'status', 'items', 'meta'],
  properties: {
    /** Gate slug: `schema`, `evidence`, `licence`, `verifiers`, `merge-rule`. */
    gate: slugSchema,
    status: { type: 'string', enum: GATE_STATUSES },
    items: { type: 'array', items: itemSchema },
    /** Free-form, gate-specific details (timings, model ids, costs, counts). */
    meta: { type: 'object' },
  },
  allOf: [
    { if: { properties: { status: { const: 'pass' } } }, then: { properties: { items: { not: hasError } } } },
    { if: { properties: { status: { const: 'fail' } } }, then: { properties: { items: hasError } } },
    {
      if: { properties: { status: { const: 'flag' } } },
      then: { properties: { items: { type: 'array', minItems: 1 } } },
    },
  ],
} as const;

export type GateResult = FromSchema<typeof gateResultSchema>;
export type GateResultItem = GateResult['items'][number];

/** ajv validator for a gate result; on failure, `validateGateResult.errors` lists every problem. */
export const validateGateResult = createAjv().compile<GateResult>(gateResultSchema);
