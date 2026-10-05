/**
 * Passage file schema (`passages/<key>.json`): the commentary for one passage, keyed by its
 * canonical passage key. It carries context, translation notes, claims, sources, provenance
 * and the review block, and never the reading text itself
 * ([ADR 0003](../../../../docs/adr/0003-never-store-reading-text.md)): a passage-level `text`
 * or `verses` field is rejected by name, on top of `additionalProperties: false`.
 *
 * Rules that span fields or files (every `[cN]` marker names a claim, every `sourceIds` entry
 * names a source, the key matches the file name and parses to real verses) belong to gate 1
 * (L-024), not to this schema.
 */
import type { FromSchema } from 'json-schema-to-ts';

import {
  CLAIM_ID_PATTERN,
  JSON_SCHEMA_DIALECT,
  createAjv,
  isoDateTimeSchema,
  localeSchema,
  nonEmptyStringSchema,
  passageKeySchema,
  schemaId,
  slugSchema,
  urlSchema,
} from '../common/index.ts';

/** Current passage schema version; bump it (and add a migration) on any breaking change. */
export const PASSAGE_SCHEMA_VERSION = 1;

/** Field names that would hold reading text and are therefore banned at passage level. */
export const FORBIDDEN_PASSAGE_FIELDS = ['text', 'verses'] as const;

export { CLAIM_ID_PATTERN };

/**
 * A context paragraph: runs of prose, each followed by one or more claim markers, ending in a
 * marker (`Matthew alone records this parable. [c1] It turns on a day's wage. [c2][c3]`).
 * Square brackets are reserved for markers.
 */
export const CONTEXT_PARAGRAPH_PATTERN = '^([^\\[\\]]+(\\[c[1-9][0-9]*\\])+)+$';

/** At most six words, e.g. the English rendering a translation note is about. */
export const ANCHOR_PATTERN = '^\\S+( \\S+){0,5}$';

/** `chapter:verse` inside the passage (`20:15`); explicit chapters keep multi-chapter passages unambiguous. */
export const NOTE_VERSE_PATTERN = '^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$';

/** Original languages a translation note can quote: Koine Greek, Biblical Hebrew, Latin. */
export const ORIGINAL_LANGUAGES = ['grc', 'hbo', 'lat'] as const;

export const SOURCE_TYPES = ['scripture', 'web', 'print'] as const;
export const GENERATORS = ['research-cli', 'manual-seed', 'fake'] as const;
export const REVIEW_STATUSES = ['pending', 'approved'] as const;
export const REVIEW_METHODS = ['human', 'auto'] as const;
export const APPROVAL_CHANNELS = ['cli', 'label', 'comment', 'auto'] as const;

const claimIdSchema = { type: 'string', pattern: CLAIM_ID_PATTERN } as const;

const languageTagSchema = {
  anyOf: [localeSchema, { type: 'string', enum: ORIGINAL_LANGUAGES }],
} as const;

const contextSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'paragraphs'],
  properties: {
    title: nonEmptyStringSchema,
    paragraphs: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', pattern: CONTEXT_PARAGRAPH_PATTERN },
    },
  },
} as const;

const translationNoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'verse', 'anchor', 'original', 'summary', 'body'],
  properties: {
    id: slugSchema,
    verse: { type: 'string', pattern: NOTE_VERSE_PATTERN },
    anchor: { type: 'string', pattern: ANCHOR_PATTERN, maxLength: 80 },
    original: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'lang', 'translit', 'gloss'],
      properties: {
        text: nonEmptyStringSchema,
        lang: { type: 'string', enum: ORIGINAL_LANGUAGES },
        translit: nonEmptyStringSchema,
        gloss: nonEmptyStringSchema,
      },
    },
    summary: { ...nonEmptyStringSchema, maxLength: 200 },
    body: nonEmptyStringSchema,
  },
} as const;

const claimSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text', 'sourceIds', 'sensitive'],
  properties: {
    id: claimIdSchema,
    text: nonEmptyStringSchema,
    sourceIds: { type: 'array', minItems: 1, uniqueItems: true, items: slugSchema },
    sensitive: { type: 'boolean' },
  },
} as const;

/** `scripture` sources need a `ref`; `web` sources need the `url` and when it was retrieved. */
const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'type', 'citation'],
  properties: {
    id: slugSchema,
    type: { type: 'string', enum: SOURCE_TYPES },
    citation: nonEmptyStringSchema,
    url: urlSchema,
    archivedUrl: urlSchema,
    ref: nonEmptyStringSchema,
    excerpt: nonEmptyStringSchema,
    excerptLang: languageTagSchema,
    retrievedAt: isoDateTimeSchema,
  },
  dependentRequired: { excerptLang: ['excerpt'] },
  allOf: [
    { if: { properties: { type: { const: 'scripture' } } }, then: { required: ['ref'] } },
    { if: { properties: { type: { const: 'web' } } }, then: { required: ['url', 'retrievedAt'] } },
  ],
} as const;

const provenanceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['generator', 'runId', 'models', 'promptVersion', 'createdAt'],
  properties: {
    generator: { type: 'string', enum: GENERATORS },
    runId: nonEmptyStringSchema,
    models: { type: 'array', uniqueItems: true, items: nonEmptyStringSchema },
    promptVersion: nonEmptyStringSchema,
    createdAt: isoDateTimeSchema,
    costUsd: { type: 'number', minimum: 0 },
  },
  allOf: [
    {
      if: { properties: { generator: { const: 'research-cli' } } },
      then: { properties: { models: { type: 'array', minItems: 1 } } },
    },
  ],
} as const;

/** What the two-family verifiers (gate 4, L-027) concluded, recorded on an auto approval. */
const verifierSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['confirmer', 'refuter', 'minSupport', 'refutations', 'sensitive'],
  properties: {
    /** Model id of the confirming verifier. */
    confirmer: nonEmptyStringSchema,
    /** Model id of the refuting verifier (a different model family). */
    refuter: nonEmptyStringSchema,
    /** Lowest per-claim support score the confirmer gave, 0–1. */
    minSupport: { type: 'number', minimum: 0, maximum: 1 },
    /** Number of claims the refuter refuted. */
    refutations: { type: 'integer', minimum: 0 },
    /** Number of claims marked sensitive. */
    sensitive: { type: 'integer', minimum: 0 },
  },
} as const;

/**
 * The review block, written by both approval paths (the human path and the auto path, L-031):
 * - `pending`: no `method` or `approvedVia` yet;
 * - `approved`: `method` and `approvedVia` are required;
 * - `method: human`: approved via `cli`, `label` or `comment` by at least one reviewer;
 * - `method: auto`: approved via `auto`, with a `verifierSummary`.
 */
const reviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reviewers'],
  properties: {
    status: { type: 'string', enum: REVIEW_STATUSES },
    method: { type: 'string', enum: REVIEW_METHODS },
    reviewers: { type: 'array', uniqueItems: true, items: nonEmptyStringSchema },
    approvedVia: { type: 'string', enum: APPROVAL_CHANNELS },
    lastReviewedAt: isoDateTimeSchema,
    verifierSummary: verifierSummarySchema,
  },
  allOf: [
    {
      if: { properties: { status: { const: 'approved' } } },
      then: { required: ['method', 'approvedVia'] },
      else: { not: { anyOf: [{ required: ['method'] }, { required: ['approvedVia'] }] } },
    },
    {
      if: { required: ['method'], properties: { method: { const: 'auto' } } },
      then: { required: ['verifierSummary'], properties: { approvedVia: { const: 'auto' } } },
    },
    {
      if: { required: ['method'], properties: { method: { const: 'human' } } },
      then: {
        properties: { approvedVia: { enum: ['cli', 'label', 'comment'] }, reviewers: { type: 'array', minItems: 1 } },
      },
    },
  ],
} as const;

export const passageSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('passage'),
  title: 'Lectio passage',
  description:
    'Commentary for one passage (passages/<key>.json). Never contains the reading text: only references, ' +
    'link-outs, commentary, claims and sources.',
  type: 'object',
  additionalProperties: false,
  propertyNames: { not: { enum: FORBIDDEN_PASSAGE_FIELDS } },
  required: [
    'key',
    'ref',
    'locale',
    'summary',
    'context',
    'translationNotes',
    'claims',
    'sources',
    'provenance',
    'review',
    'schemaVersion',
  ],
  properties: {
    key: passageKeySchema,
    ref: nonEmptyStringSchema,
    locale: localeSchema,
    summary: { ...nonEmptyStringSchema, maxLength: 140 },
    context: contextSchema,
    translationNotes: { type: 'array', items: translationNoteSchema },
    claims: { type: 'array', minItems: 1, items: claimSchema },
    sources: { type: 'array', minItems: 1, items: sourceSchema },
    provenance: provenanceSchema,
    review: reviewSchema,
    schemaVersion: { const: PASSAGE_SCHEMA_VERSION },
  },
} as const;

export type Passage = FromSchema<typeof passageSchema>;
export type PassageReview = Passage['review'];
export type PassageClaim = Passage['claims'][number];
export type PassageSource = Passage['sources'][number];
export type TranslationNote = Passage['translationNotes'][number];

/** ajv validator for a passage file; on failure, `validatePassage.errors` lists every problem. */
export const validatePassage = createAjv().compile<Passage>(passageSchema);
