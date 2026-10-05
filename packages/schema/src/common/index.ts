/**
 * Building blocks shared by every Lectio content schema (`@lectio/schema/common`).
 *
 * Each fragment is a JSON Schema 2020-12 object declared `as const`, so the top-level
 * schemas embed it directly (the emitted `json/*.schema.json` files are self-contained,
 * with no cross-file `$ref`) and `json-schema-to-ts` can derive exact TypeScript types.
 *
 * Validators are compiled with {@link createAjv}, which knows the formats used here
 * (`date`, `date-time`, `uri`).
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv/dist/2020.js';

import { isIsoDate } from '@lectio/shared';

/** The JSON Schema dialect every Lectio schema declares. */
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Base URI for the `$id` of each emitted schema: `<base><name>.schema.json`. */
export const SCHEMA_ID_BASE = 'https://github.com/nyabongo/lectio/schema/';

/** `$id` for the schema named `name` (e.g. `passage` → `.../passage.schema.json`). */
export function schemaId<const N extends string>(name: N): `${typeof SCHEMA_ID_BASE}${N}.schema.json` {
  return `${SCHEMA_ID_BASE}${name}.schema.json`;
}

/** A calendar date, `YYYY-MM-DD`; the `date` format also rejects impossible days such as `2026-02-30`. */
export const isoDateSchema = {
  type: 'string',
  pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$',
  format: 'date',
} as const;

/** An RFC 3339 timestamp with an explicit offset, e.g. `2026-09-01T08:30:00Z`. */
export const isoDateTimeSchema = {
  type: 'string',
  format: 'date-time',
} as const;

/** An absolute http(s) URL. */
export const urlSchema = {
  type: 'string',
  format: 'uri',
  pattern: '^https?://',
} as const;

/** A BCP 47 language tag in the subset Lectio uses: `en`, `en-KE`, `sw`, `pt-BR`, `zh-Hant`, `es-419`. */
export const localeSchema = {
  type: 'string',
  pattern: '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$',
} as const;

/** A lower-case kebab-case identifier, stable across regenerations (`evil-eye`, `daily-wage`). */
export const slugSchema = {
  type: 'string',
  pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
  maxLength: 64,
} as const;

/** A non-empty string without leading or trailing whitespace. */
export const nonEmptyStringSchema = {
  type: 'string',
  minLength: 1,
  pattern: '^\\S(.*\\S)?$',
} as const;

/**
 * Shape of a canonical passage key ([ADR 0004](../../../../docs/adr/0004-passage-keys-and-book-codes.md)):
 * the book code once, then `_`-joined segments, each one of `chapter`, `chapter-chapter`,
 * `chapter.verse`, `chapter.verse-verse` or `chapter.verse-chapter.verse` (the grammar `toKey`
 * in `@lectio/refs` writes). Examples: `MT.20.1-16`, `PHIL.1.20-24_1.27`, `ECCL.11.9-12.8`,
 * `PS.23` (whole chapter), `IS.40-41` (chapter range), `PS.23_24.1-3` (mixed segments).
 * A range never mixes a whole chapter with a verse (`MT.1-2.3` fails).
 *
 * This checks shape only. Whether the book code exists and the verses are real is the reference
 * parser's job (`@lectio/refs`, L-005), applied by gate 1 (L-024).
 */
const KEY_NUMBER = '[1-9][0-9]{0,2}';
const KEY_SEGMENT = `${KEY_NUMBER}(-${KEY_NUMBER}|\\.${KEY_NUMBER}(-(${KEY_NUMBER}\\.)?${KEY_NUMBER})?)?`;
export const PASSAGE_KEY_PATTERN = `^[1-3]?[A-Z]{2,5}\\.${KEY_SEGMENT}(_${KEY_SEGMENT})*$`;

/** A claim id, `c1`, `c2`, …; context paragraphs cite claims with `[c1]` markers. */
export const CLAIM_ID_PATTERN = '^c[1-9][0-9]*$';

/** A canonical passage key; also used as the passage file name (`passages/<key>.json`). */
export const passageKeySchema = {
  type: 'string',
  pattern: PASSAGE_KEY_PATTERN,
  maxLength: 120,
} as const;

/** Liturgical colours of the Roman Rite (GIRM 346), lower case. */
export const LITURGICAL_COLOURS = ['white', 'red', 'green', 'violet', 'rose', 'black', 'gold'] as const;
export type LiturgicalColour = (typeof LITURGICAL_COLOURS)[number];

export const liturgicalColourSchema = { type: 'string', enum: LITURGICAL_COLOURS } as const;

/** Numbered slots for Masses with many readings (the Easter Vigil has up to nine). */
const numbered = <const P extends string>(prefix: P) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${prefix}-${String(n)}` as `${P}-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`);

/**
 * Where a reading sits in a Mass. Sunday and weekday Masses use the named slots; the Easter
 * Vigil uses `reading-1`…`reading-9` and `psalm-1`…`psalm-9`, then `epistle` and `gospel`.
 */
export const READING_SLOTS = [
  'first-reading',
  'psalm',
  'second-reading',
  'gospel',
  ...numbered('reading'),
  ...numbered('psalm'),
  'epistle',
] as const;
export type ReadingSlot = (typeof READING_SLOTS)[number];

export const readingSlotSchema = { type: 'string', enum: READING_SLOTS } as const;

const RFC3339_DATE_TIME =
  /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/i;

/** True for an RFC 3339 timestamp with a real calendar date and an explicit offset. */
export function isIsoDateTime(value: string): boolean {
  const match = RFC3339_DATE_TIME.exec(value);
  return match !== null && isIsoDate(match[1]);
}

/** True for an absolute URL that the WHATWG URL parser accepts. */
export function isAbsoluteUrl(value: string): boolean {
  return URL.canParse(value);
}

/**
 * A strict 2020-12 ajv instance with every format Lectio schemas use. `allErrors` is on so a
 * gate can report every problem in a file at once. `strictRequired` is off because conditional
 * `then: { required: [...] }` branches name properties declared by the enclosing schema.
 */
export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  ajv.addFormat('date', { type: 'string', validate: isIsoDate });
  ajv.addFormat('date-time', { type: 'string', validate: isIsoDateTime });
  ajv.addFormat('uri', { type: 'string', validate: isAbsoluteUrl });
  return ajv;
}

/** One line per ajv error, `<instancePath or /> <message>`, for logs and gate messages. */
export function formatErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map(
    (error) => `${error.instancePath === '' ? '/' : error.instancePath} ${String(error.message)}`,
  );
}

export type { ErrorObject };
