/**
 * The research response schema: the part of a passage file the model writes. The assembler adds
 * the rest (key, ref, locale, translation-note ids, provenance, review, schema version).
 *
 * It reuses the passage schema's own fragments, so a field the model writes has exactly the rules
 * the passage file has, with two differences: a `web` source may leave out `retrievedAt` (the
 * assembler fills in the run time), and a passage has at most {@link MAX_TRANSLATION_NOTES} notes.
 *
 * The excerpt word limit is a prompt rule, not a schema rule: a schema mismatch makes a live client
 * re-run the whole research call, while an over-long excerpt is cheaper to catch in the licence
 * gate and fix in the repair loop (L-036).
 */
import type { LicenceGuardConfig } from '@lectio/config';
import type { JsonSchema } from '@lectio/providers';
import { passageSchema } from '@lectio/schema/passage';
import type { Passage } from '@lectio/schema/passage';

/** Most translation notes one passage may have (the seed has four). */
export const MAX_TRANSLATION_NOTES = 5;

/**
 * Longest verbatim excerpt the model may copy, in words: the tightest of the licence guard's limits
 * (ADR 0003: the limits are configuration). An excerpt is commentary or Bible wording, so it must
 * also fit the guard's longest allowed verbatim run of either (12 words by default).
 */
export function excerptWordLimit(
  guard: Pick<LicenceGuardConfig, 'maxExcerptWords' | 'maxCommentaryRunWords' | 'maxBibleRunWords'>,
): number {
  return Math.min(guard.maxExcerptWords, guard.maxCommentaryRunWords, guard.maxBibleRunWords);
}

const { properties } = passageSchema;
const noteItems = properties.translationNotes.items;
const sourceItems = properties.sources.items;

const { id: _noteId, ...noteProperties } = noteItems.properties;

const responseNoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: noteItems.required.filter((field) => field !== 'id'),
  properties: noteProperties,
} as const;

const responseSourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: sourceItems.required,
  properties: sourceItems.properties,
  dependentRequired: sourceItems.dependentRequired,
  allOf: [
    { if: { properties: { type: { const: 'scripture' } } }, then: { required: ['ref'] } },
    { if: { properties: { type: { const: 'web' } } }, then: { required: ['url'] } },
  ],
} as const;

/** The JSON Schema sent as `responseSchema` on the research call. */
export const RESEARCH_RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'context', 'translationNotes', 'claims', 'sources'],
  properties: {
    summary: properties.summary,
    context: properties.context,
    translationNotes: { type: 'array', maxItems: MAX_TRANSLATION_NOTES, items: responseNoteSchema },
    claims: properties.claims,
    sources: { type: 'array', minItems: 1, items: responseSourceSchema },
  },
};

type PassageNote = Passage['translationNotes'][number];
type PassageSource = Passage['sources'][number];

/** A model-written source: a passage source whose `retrievedAt` may be missing. */
export type ResearchSource = Omit<PassageSource, 'retrievedAt'> & { readonly retrievedAt?: string };

/** What the model returns (once it matches {@link RESEARCH_RESPONSE_SCHEMA}). */
export interface ResearchOutput {
  readonly summary: string;
  readonly context: Passage['context'];
  readonly translationNotes: readonly Omit<PassageNote, 'id'>[];
  readonly claims: Passage['claims'];
  readonly sources: readonly ResearchSource[];
}
