/**
 * Translated-passage schema (`passages/i18n/<locale>/<key>.json`, L-112): the commentary of one
 * English passage file in another language. Adding a language means adding files, not changing
 * structure.
 *
 * A translation carries only what a reader reads: the summary, the context (title and
 * paragraphs), each translation note's summary, body, gloss and optional localised anchor, and each
 * claim's text. Ids are reused from the English file (notes by `id`, claims by `c1`, `c2`, …), and
 * everything else (references, original-language words, sources, claim `sourceIds`) is read from
 * the English file and never translated. Like the passage, it never contains reading text
 * ([ADR 0003](../../../../docs/adr/0003-never-store-reading-text.md)): `text` and `verses` are
 * banned by name.
 *
 * `sourceSha256` is {@link translatableSha256} of the English file the translation was made from
 * (its translatable fields, whitespace- and NFC-normalised);
 * gate 1 flags the translation as stale when the English text changes (`schema/translation-not-stale`).
 *
 * The review block has no auto path: a translation is approved by a person or not at all.
 *
 * Rules that span files (the English file exists, ids and claim markers match it) are checked by
 * {@link translationMismatches}, which gate 1 and the translate command both apply.
 */
import { createHash } from 'node:crypto';

import type { FromSchema } from 'json-schema-to-ts';

import {
  CLAIM_ID_PATTERN,
  JSON_SCHEMA_DIALECT,
  createAjv,
  localeSchema,
  nonEmptyStringSchema,
  passageKeySchema,
  schemaId,
  slugSchema,
} from '../common/index.ts';
import {
  ANCHOR_PATTERN,
  CONTEXT_PARAGRAPH_PATTERN,
  FORBIDDEN_PASSAGE_FIELDS,
  NOTE_BODY_PATTERN,
  passageSchema,
} from '../passage/index.ts';
import type { Passage } from '../passage/index.ts';

/** Current translated-passage schema version; bump it (and add a migration) on any breaking change. */
export const TRANSLATED_PASSAGE_SCHEMA_VERSION = 1;

/** Directory of translations under the content root: `passages/i18n/<locale>/<key>.json`. */
export const TRANSLATIONS_DIR = 'passages/i18n';

/** Locales a translation may not use: English is the source language (`en`, `en-KE`, …). */
export const SOURCE_LOCALE_PATTERN = '^en(-|$)';

/** A lowercase hex sha256 digest. */
export const SHA256_PATTERN = '^[0-9a-f]{64}$';

/** Approval channels of a translation: only the human ones (no auto-merge for translations). */
export const TRANSLATION_APPROVAL_CHANNELS = ['cli', 'label', 'comment'] as const;

const passageReview = passageSchema.properties.review.properties;

/**
 * The review block of a translation: the passage's human path only.
 * - `pending`: no `method` or `approvedVia` yet;
 * - `approved`: `method: human`, `approvedVia` `cli`, `label` or `comment`, and at least one reviewer.
 */
const translationReviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reviewers'],
  properties: {
    status: passageReview.status,
    method: { type: 'string', const: 'human' },
    reviewers: passageReview.reviewers,
    approvedVia: { type: 'string', enum: TRANSLATION_APPROVAL_CHANNELS },
    lastReviewedAt: passageReview.lastReviewedAt,
  },
  allOf: [
    {
      if: { properties: { status: { const: 'approved' } } },
      then: {
        required: ['method', 'approvedVia'],
        properties: { reviewers: { type: 'array', minItems: 1 } },
      },
      else: { not: { anyOf: [{ required: ['method'] }, { required: ['approvedVia'] }] } },
    },
  ],
} as const;

const translatedNoteSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'gloss', 'summary', 'body'],
  properties: {
    /** The English note's id. */
    id: slugSchema,
    /** The word or phrase the note is about, as a reader of this language would know it (at most six words). */
    anchor: { type: 'string', pattern: ANCHOR_PATTERN, maxLength: 80 },
    /** The gloss of the original words, in this language. */
    gloss: nonEmptyStringSchema,
    summary: { ...nonEmptyStringSchema, maxLength: 240 },
    /** Same `[cN]` markers as the English body. */
    body: { type: 'string', pattern: NOTE_BODY_PATTERN },
  },
} as const;

const translatedClaimSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'text'],
  properties: {
    /** The English claim's id; its sources stay in the English file. */
    id: { type: 'string', pattern: CLAIM_ID_PATTERN },
    text: nonEmptyStringSchema,
  },
} as const;

export const translatedPassageSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('translated-passage'),
  title: 'Lectio translated passage',
  description:
    'The commentary of one passage in another language (passages/i18n/<locale>/<key>.json). Ids are reused ' +
    'from the English file; sources are not translated. Never contains the reading text.',
  type: 'object',
  additionalProperties: false,
  propertyNames: { not: { enum: FORBIDDEN_PASSAGE_FIELDS } },
  required: [
    'translationOf',
    'locale',
    'sourceSha256',
    'summary',
    'context',
    'translationNotes',
    'claims',
    'provenance',
    'review',
    'schemaVersion',
  ],
  properties: {
    /** Key of the English passage (`passages/<key>.json`); equals the file name. */
    translationOf: passageKeySchema,
    /** Language of this translation; equals the directory name and is never English. */
    locale: { ...localeSchema, not: { type: 'string', pattern: SOURCE_LOCALE_PATTERN } },
    /** `translatableSha256` of the English file this translation was made from. */
    sourceSha256: { type: 'string', pattern: SHA256_PATTERN },
    summary: { ...nonEmptyStringSchema, maxLength: 200 },
    context: {
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
    },
    translationNotes: { type: 'array', items: translatedNoteSchema },
    claims: { type: 'array', minItems: 1, items: translatedClaimSchema },
    provenance: passageSchema.properties.provenance,
    review: translationReviewSchema,
    schemaVersion: { const: TRANSLATED_PASSAGE_SCHEMA_VERSION },
  },
} as const;

export type TranslatedPassage = FromSchema<typeof translatedPassageSchema>;
export type TranslatedNote = TranslatedPassage['translationNotes'][number];
export type TranslatedClaim = TranslatedPassage['claims'][number];
export type TranslationReview = TranslatedPassage['review'];

/** ajv validator for a translation file; on failure, `validateTranslatedPassage.errors` lists every problem. */
export const validateTranslatedPassage = createAjv().compile<TranslatedPassage>(translatedPassageSchema);

/** Repository-relative path (under the content root) of a translation: `passages/i18n/sw/MT.20.1-16.json`. */
export function translatedPassagePath(locale: string, key: string): string {
  return `${TRANSLATIONS_DIR}/${locale}/${key}.json`;
}

const LOCALE = new RegExp(localeSchema.pattern);
const KEY = new RegExp(passageKeySchema.pattern);
const SOURCE_LOCALE = new RegExp(SOURCE_LOCALE_PATTERN);

/**
 * The locale and key a translation path promises (`passages/i18n/sw/MT.20.1-16.json` →
 * `{ locale: 'sw', key: 'MT.20.1-16' }`), or `null` when `path` (relative to the content root) is
 * not a translation file. An English locale directory is not a translation directory.
 */
export function parseTranslatedPassagePath(path: string): { readonly locale: string; readonly key: string } | null {
  const prefix = `${TRANSLATIONS_DIR}/`;
  if (!path.startsWith(prefix) || !path.endsWith('.json')) return null;
  const parts = path.slice(prefix.length, -'.json'.length).split('/');
  if (parts.length !== 2) return null;
  const [locale, key] = parts as [string, string];
  if (!LOCALE.test(locale) || SOURCE_LOCALE.test(locale) || !KEY.test(key)) return null;
  return { locale, key };
}

/** The fields of an English passage a translation renders, in a fixed order. */
export interface TranslatableFields {
  readonly summary: string;
  readonly context: { readonly title: string; readonly paragraphs: readonly string[] };
  readonly translationNotes: readonly {
    readonly id: string;
    readonly anchor: string;
    readonly gloss: string;
    readonly summary: string;
    readonly body: string;
  }[];
  readonly claims: readonly { readonly id: string; readonly text: string }[];
}

/** What a translator works from: the English passage's translatable fields, nothing else. */
export function translatableFields(passage: Passage): TranslatableFields {
  return {
    summary: passage.summary,
    context: { title: passage.context.title, paragraphs: [...passage.context.paragraphs] },
    translationNotes: passage.translationNotes.map((note) => ({
      id: note.id,
      anchor: note.anchor,
      gloss: note.original.gloss,
      summary: note.summary,
      body: note.body,
    })),
    claims: passage.claims.map((claim) => ({ id: claim.id, text: claim.text })),
  };
}

/**
 * How a string is normalised before hashing: Unicode NFC, every run of whitespace collapsed to one
 * space, and leading and trailing whitespace trimmed. Edits that change no wording (a double or
 * trailing space, a line break, NFD vs NFC accents) leave the hash unchanged.
 */
export function normaliseForHash(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * sha256 (hex) of the English passage's translatable fields, which is what `sourceSha256` records.
 *
 * Exactly what is hashed: the UTF-8 bytes of `JSON.stringify` of {@link translatableFields} (keys
 * in the fixed order `summary`, `context` {`title`, `paragraphs`}, `translationNotes` [{`id`,
 * `anchor`, `gloss`, `summary`, `body`}], `claims` [{`id`, `text`}]), with every string first passed
 * through {@link normaliseForHash}. Ids, claim markers and the order of paragraphs, notes and claims
 * count (a translation follows that order); sources, references, original-language words other
 * than the gloss, provenance and the review block do not.
 */
export function translatableSha256(passage: Passage): string {
  const fields = translatableFields(passage);
  const normalised: TranslatableFields = {
    summary: normaliseForHash(fields.summary),
    context: {
      title: normaliseForHash(fields.context.title),
      paragraphs: fields.context.paragraphs.map(normaliseForHash),
    },
    translationNotes: fields.translationNotes.map((note) => ({
      id: normaliseForHash(note.id),
      anchor: normaliseForHash(note.anchor),
      gloss: normaliseForHash(note.gloss),
      summary: normaliseForHash(note.summary),
      body: normaliseForHash(note.body),
    })),
    claims: fields.claims.map((claim) => ({ id: normaliseForHash(claim.id), text: normaliseForHash(claim.text) })),
  };
  return createHash('sha256').update(JSON.stringify(normalised), 'utf8').digest('hex');
}

/** One way a translation does not line up with its English passage. */
export interface TranslationMismatch {
  /** RFC 6901 pointer into the translation file. */
  readonly pointer: string;
  readonly message: string;
}

const MARKER = /\[(c[1-9][0-9]*)\]/g;

/** The distinct claim ids a text cites, sorted. */
export function citedClaimIds(text: string): string[] {
  return [...new Set([...text.matchAll(MARKER)].map((match) => match[1] as string))].sort();
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function list(ids: readonly string[]): string {
  return ids.length === 0 ? 'none' : ids.join(', ');
}

function compareIds(
  out: TranslationMismatch[],
  pointer: string,
  what: string,
  english: readonly string[],
  translated: readonly string[],
): void {
  const seen = new Set<string>();
  translated.forEach((id, index) => {
    if (seen.has(id)) {
      out.push({ pointer: `${pointer}/${String(index)}/id`, message: `${what} ${id} is translated more than once` });
    }
    seen.add(id);
  });
  const known = new Set(english);
  translated.forEach((id, index) => {
    if (known.has(id)) return;
    out.push({
      pointer: `${pointer}/${String(index)}/id`,
      message: `${what} ${id} is not in the English passage`,
    });
  });
  const missing = english.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    out.push({ pointer, message: `${what}s missing from the translation: ${missing.join(', ')}` });
  }
}

function compareMarkers(out: TranslationMismatch[], pointer: string, english: string, translated: string): void {
  const expected = citedClaimIds(english);
  const actual = citedClaimIds(translated);
  if (sameIds(expected, actual)) return;
  out.push({
    pointer,
    message: `cites claims ${list(actual)}, but the English text cites ${list(expected)}`,
  });
}

/**
 * Every way `translated` fails to line up with `english`, the passage it translates: the key,
 * the same note and claim ids (each once, none missing or extra), the same number of context
 * paragraphs, and the same claim markers in each paragraph and note body, so every sentence stays
 * cited by the claims (and sources) of the English file. Empty when they line up.
 */
export function translationMismatches(english: Passage, translated: TranslatedPassage): TranslationMismatch[] {
  const out: TranslationMismatch[] = [];
  if (translated.translationOf !== english.key) {
    out.push({
      pointer: '/translationOf',
      message: `translationOf ${translated.translationOf} is not the English passage ${english.key}`,
    });
  }
  compareIds(
    out,
    '/translationNotes',
    'translation note',
    english.translationNotes.map((note) => note.id),
    translated.translationNotes.map((note) => note.id),
  );
  compareIds(
    out,
    '/claims',
    'claim',
    english.claims.map((claim) => claim.id),
    translated.claims.map((claim) => claim.id),
  );
  const englishParagraphs = english.context.paragraphs;
  const paragraphs = translated.context.paragraphs;
  if (englishParagraphs.length !== paragraphs.length) {
    out.push({
      pointer: '/context/paragraphs',
      message: `has ${String(paragraphs.length)} paragraphs, but the English context has ${String(englishParagraphs.length)}`,
    });
  }
  paragraphs.forEach((paragraph, index) => {
    const source = englishParagraphs[index];
    if (source !== undefined) compareMarkers(out, `/context/paragraphs/${String(index)}`, source, paragraph);
  });
  const englishNotes = new Map(english.translationNotes.map((note) => [note.id, note]));
  translated.translationNotes.forEach((note, index) => {
    const source = englishNotes.get(note.id);
    if (source !== undefined) compareMarkers(out, `/translationNotes/${String(index)}/body`, source.body, note.body);
  });
  return out;
}
