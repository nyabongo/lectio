/**
 * The research response schema: the part of a passage file the model writes. The assembler adds
 * the rest (key, ref, locale, translation-note ids, provenance, review, schema version).
 *
 * It reuses the passage schema's own fragments, so a field the model writes has exactly the rules
 * the passage file has, with two differences: a `web` source may leave out `retrievedAt` (the
 * assembler fills in the run time), and every `excerpt` is at most {@link MAX_EXCERPT_WORDS} words.
 */
import type { JsonSchema } from '@lectio/providers';
import { passageSchema } from '@lectio/schema/passage';
import type { Passage } from '@lectio/schema/passage';

/** Longest verbatim excerpt the model may copy from a source, in words. */
export const MAX_EXCERPT_WORDS = 12;

const { properties } = passageSchema;
const noteItems = properties.translationNotes.items;
const sourceItems = properties.sources.items;

/** `n` words or fewer, single-spaced, no leading or trailing space. */
export function wordsPattern(n: number): string {
  return `^\\S+( \\S+){0,${String(n - 1)}}$`;
}

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
  properties: {
    ...sourceItems.properties,
    excerpt: { type: 'string', pattern: wordsPattern(MAX_EXCERPT_WORDS) },
  },
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
    translationNotes: { type: 'array', maxItems: 8, items: responseNoteSchema },
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
