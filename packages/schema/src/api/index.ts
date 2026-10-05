/**
 * Static JSON API v1 schemas (`@lectio/schema/api`): the documents the site publishes under `/api/v1/` for the
 * Flutter apps and the service worker ([docs/api.md](../../../../docs/api.md)). There is no server: every document
 * is a file written at build time from the content repository, and only approved notes are ever exposed.
 *
 * | Path                              | Schema                   | Validator                 |
 * | --------------------------------- | ------------------------ | ------------------------- |
 * | `/api/v1/index.json`              | `apiIndexSchema`         | `validateApiIndex`        |
 * | `/api/v1/days/{date}.json`        | `apiDaySchema`           | `validateApiDay`          |
 * | `/api/v1/passages/index.json`     | `apiPassageIndexSchema`  | `validateApiPassageIndex` |
 * | `/api/v1/passages/{key}.json`     | `apiPassageSchema`       | `validateApiPassage`      |
 * | `/api/v1/calendar/{year}.json`    | `apiCalendarSchema`      | `validateApiCalendar`     |
 * | `/api/v1/upcoming.json`           | `apiUpcomingSchema`      | `validateApiUpcoming`     |
 *
 * The fragments reuse the passage and calendar schemas (`passageSchema.properties…`), so the API cannot drift from
 * the content model. v1 changes are additive only: new optional fields or new documents, never a removal or a
 * change of meaning. The schemas describe the current shape exactly (`additionalProperties: false`), so the site's
 * tests catch anything that would leak (provenance, pending notes); clients must ignore fields they do not know.
 */
import type { FromSchema } from 'json-schema-to-ts';

import { calendarYearSchema } from '../calendar/index.ts';
import {
  JSON_SCHEMA_DIALECT,
  createAjv,
  isoDateSchema,
  isoDateTimeSchema,
  liturgicalColourSchema,
  localeSchema,
  nonEmptyStringSchema,
  passageKeySchema,
  schemaId,
  urlSchema,
} from '../common/index.ts';
import { passageSchema } from '../passage/index.ts';

/** The API version every document carries as `apiVersion`; the path segment is `/api/v<API_VERSION>/`. */
export const API_VERSION = 1;

/** How many days `upcoming.json` lists: the build date and the 13 days after it. */
export const UPCOMING_DAYS = 14;

/** Endpoint templates, relative to the API root (`<site>/api/v1/`). `{date}`, `{key}` and `{year}` are filled in. */
export const API_ENDPOINTS = {
  index: 'index.json',
  day: 'days/{date}.json',
  passages: 'passages/index.json',
  passage: 'passages/{key}.json',
  calendar: 'calendar/{year}.json',
  upcoming: 'upcoming.json',
} as const;

const apiVersionSchema = { const: API_VERSION } as const;

/**
 * A rendered narration file. Every `audio` field is `null` until the narration pipeline (Phase 2, L-082) fills it;
 * clients fall back to device text-to-speech when it is `null`.
 */
const audioSchema = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: urlSchema,
        durationSeconds: { type: 'number', minimum: 0 },
      },
    },
  ],
} as const;

const passageProps = passageSchema.properties;
const contextBase = passageProps.context;
const noteBase = passageProps.translationNotes.items;

/** The context note, with its narration. */
const apiContextSchema = {
  ...contextBase,
  required: [...contextBase.required, 'audio'],
  properties: { ...contextBase.properties, audio: audioSchema },
} as const;

/** A translation note, with its narration. */
const apiTranslationNoteSchema = {
  ...noteBase,
  required: [...noteBase.required, 'audio'],
  properties: { ...noteBase.properties, audio: audioSchema },
} as const;

/** What the reader is told about the review: approved, how, and when it was last reviewed. */
const apiReviewSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'method', 'lastReviewedAt'],
  properties: {
    status: { const: 'approved' },
    method: passageProps.review.properties.method,
    lastReviewedAt: { anyOf: [{ type: 'null' }, isoDateTimeSchema] },
  },
} as const;

/**
 * The approved notes for one passage: the passage file without its provenance and with a reader-facing review
 * block. Never the reading text.
 */
const apiNotesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'ref', 'locale', 'summary', 'context', 'translationNotes', 'claims', 'sources', 'review'],
  properties: {
    key: passageKeySchema,
    ref: passageProps.ref,
    locale: localeSchema,
    summary: passageProps.summary,
    context: apiContextSchema,
    translationNotes: { type: 'array', items: apiTranslationNoteSchema },
    claims: passageProps.claims,
    sources: passageProps.sources,
    review: apiReviewSchema,
  },
} as const;

const calendarDay = calendarYearSchema.properties.days.items;
const calendarDayProps = calendarDay.properties;
const calendarReading = calendarDayProps.masses.items.properties.readings.items;

/** The calendar fields every day document repeats, plus `colour`: the principal celebration's colour. */
const dayHeaderProperties = {
  date: isoDateSchema,
  season: calendarDayProps.season,
  seasonWeek: calendarDayProps.seasonWeek,
  sundayCycle: calendarDayProps.sundayCycle,
  weekdayCycle: calendarDayProps.weekdayCycle,
  colour: liturgicalColourSchema,
  celebrations: calendarDayProps.celebrations,
  lectionaryMissing: calendarDayProps.lectionaryMissing,
} as const;

const dayHeaderRequired = [
  'date',
  'season',
  'seasonWeek',
  'sundayCycle',
  'weekdayCycle',
  'colour',
  'celebrations',
  'lectionaryMissing',
  'masses',
] as const;

/** A reading in a day document: the calendar reading with its approved notes inline (`null` when none). */
const apiDayReadingSchema = {
  type: 'object',
  additionalProperties: false,
  required: [...calendarReading.required, 'passage'],
  properties: {
    ...calendarReading.properties,
    passage: { anyOf: [{ type: 'null' }, apiNotesSchema] },
  },
} as const;

/** A reading in a calendar or upcoming listing: the calendar reading, whether notes exist, and their summary. */
const apiReadingSummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: [...calendarReading.required, 'hasNotes', 'summary'],
  properties: {
    ...calendarReading.properties,
    hasNotes: { type: 'boolean' },
    summary: { anyOf: [{ type: 'null' }, passageProps.summary] },
  },
} as const;

function massSchema<const R extends object>(readings: R) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'label', 'readings'],
    properties: {
      id: calendarDayProps.masses.items.properties.id,
      label: calendarDayProps.masses.items.properties.label,
      readings: { type: 'array', items: readings },
    },
  } as const;
}

/** A day in `calendar/{year}.json` and `upcoming.json`: everything but the notes themselves. */
const apiDaySummarySchema = {
  type: 'object',
  additionalProperties: false,
  required: dayHeaderRequired,
  properties: { ...dayHeaderProperties, masses: { type: 'array', items: massSchema(apiReadingSummarySchema) } },
} as const;

export const apiIndexSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('api-index'),
  title: 'Lectio API v1 index',
  description:
    'Entry point of the static JSON API (/api/v1/index.json): build date, the dates and years available, ' +
    'and the endpoint templates relative to the API root.',
  type: 'object',
  additionalProperties: false,
  required: [
    'apiVersion',
    'buildDate',
    'timezone',
    'defaultLocale',
    'locales',
    'apiRoot',
    'years',
    'dates',
    'passageCount',
    'endpoints',
  ],
  properties: {
    apiVersion: apiVersionSchema,
    /** The date the build treated as today, in `timezone`. */
    buildDate: isoDateSchema,
    /** IANA time zone of the site's calendar (`Africa/Nairobi`). */
    timezone: nonEmptyStringSchema,
    defaultLocale: localeSchema,
    locales: { type: 'array', minItems: 1, uniqueItems: true, items: localeSchema },
    /** Absolute URL of the API root; endpoint templates resolve against it. */
    apiRoot: urlSchema,
    /** Years with a calendar document, ascending. */
    years: { type: 'array', uniqueItems: true, items: { type: 'integer', minimum: 1970, maximum: 9999 } },
    /** First and last date with a day document, or `null` when there is none. */
    dates: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['first', 'last'],
          properties: { first: isoDateSchema, last: isoDateSchema },
        },
      ],
    },
    /** How many passages have approved notes (entries in `passages/index.json`). */
    passageCount: { type: 'integer', minimum: 0 },
    endpoints: {
      type: 'object',
      additionalProperties: false,
      required: ['index', 'day', 'passages', 'passage', 'calendar', 'upcoming'],
      properties: {
        index: { const: API_ENDPOINTS.index },
        day: { const: API_ENDPOINTS.day },
        passages: { const: API_ENDPOINTS.passages },
        passage: { const: API_ENDPOINTS.passage },
        calendar: { const: API_ENDPOINTS.calendar },
        upcoming: { const: API_ENDPOINTS.upcoming },
      },
    },
  },
} as const;

export const apiDaySchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('api-day'),
  title: 'Lectio API v1 day',
  description:
    'One liturgical day (/api/v1/days/{date}.json): celebrations, Masses and readings by reference and ' +
    'link-out, with the approved notes of each reading inline. Never contains the reading text.',
  type: 'object',
  additionalProperties: false,
  required: ['apiVersion', ...dayHeaderRequired],
  properties: {
    apiVersion: apiVersionSchema,
    ...dayHeaderProperties,
    masses: { type: 'array', items: massSchema(apiDayReadingSchema) },
  },
} as const;

export const apiPassageSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('api-passage'),
  title: 'Lectio API v1 passage',
  description:
    'The approved notes for one passage (/api/v1/passages/{key}.json) and every calendar date it is read on. ' +
    'Never contains the reading text.',
  type: 'object',
  additionalProperties: false,
  required: ['apiVersion', 'passage', 'dates'],
  properties: {
    apiVersion: apiVersionSchema,
    passage: apiNotesSchema,
    /** Calendar dates with a reading of this passage, ascending. */
    dates: { type: 'array', uniqueItems: true, items: isoDateSchema },
  },
} as const;

export const apiPassageIndexSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('api-passage-index'),
  title: 'Lectio API v1 passage index',
  description: 'Every passage with approved notes (/api/v1/passages/index.json), sorted by key.',
  type: 'object',
  additionalProperties: false,
  required: ['apiVersion', 'passages'],
  properties: {
    apiVersion: apiVersionSchema,
    passages: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'ref', 'summary', 'lastReviewedAt', 'dates'],
        properties: {
          key: passageKeySchema,
          ref: passageProps.ref,
          summary: passageProps.summary,
          lastReviewedAt: apiReviewSchema.properties.lastReviewedAt,
          dates: apiPassageSchema.properties.dates,
        },
      },
    },
  },
} as const;

export const apiCalendarSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('api-calendar'),
  title: 'Lectio API v1 calendar year',
  description:
    'Every day of one civil year (/api/v1/calendar/{year}.json) with its readings, whether each has notes, ' +
    'and their one-line summary.',
  type: 'object',
  additionalProperties: false,
  required: ['apiVersion', 'year', 'region', 'days'],
  properties: {
    apiVersion: apiVersionSchema,
    year: calendarYearSchema.properties.year,
    region: calendarYearSchema.properties.region,
    days: { type: 'array', items: apiDaySummarySchema },
  },
} as const;

export const apiUpcomingSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('api-upcoming'),
  title: 'Lectio API v1 upcoming days',
  description:
    'The build date and the 13 days after it in the site time zone (/api/v1/upcoming.json); dates the ' +
    'calendar does not have are left out.',
  type: 'object',
  additionalProperties: false,
  required: ['apiVersion', 'timezone', 'from', 'to', 'days'],
  properties: {
    apiVersion: apiVersionSchema,
    timezone: nonEmptyStringSchema,
    /** The build date (first date of the window). */
    from: isoDateSchema,
    /** The last date of the window, `from` + 13 days. */
    to: isoDateSchema,
    days: { type: 'array', maxItems: UPCOMING_DAYS, items: apiDaySummarySchema },
  },
} as const;

/** Every API schema, by emitted file stem (`json/<stem>.schema.json`). */
export const API_SCHEMAS = {
  'api-index': apiIndexSchema,
  'api-day': apiDaySchema,
  'api-passage': apiPassageSchema,
  'api-passage-index': apiPassageIndexSchema,
  'api-calendar': apiCalendarSchema,
  'api-upcoming': apiUpcomingSchema,
} as const;

export type ApiIndex = FromSchema<typeof apiIndexSchema>;
export type ApiDay = FromSchema<typeof apiDaySchema>;
export type ApiPassage = FromSchema<typeof apiPassageSchema>;
export type ApiPassageIndex = FromSchema<typeof apiPassageIndexSchema>;
export type ApiCalendar = FromSchema<typeof apiCalendarSchema>;
export type ApiUpcoming = FromSchema<typeof apiUpcomingSchema>;
export type ApiNotes = ApiPassage['passage'];
export type ApiAudio = ApiNotes['context']['audio'];
export type ApiDayReading = ApiDay['masses'][number]['readings'][number];
export type ApiDaySummary = ApiCalendar['days'][number];
export type ApiReadingSummary = ApiDaySummary['masses'][number]['readings'][number];
export type ApiPassageIndexEntry = ApiPassageIndex['passages'][number];

const ajv = createAjv();

/** ajv validators, one per document; on failure, `.errors` lists every problem. */
export const validateApiIndex = ajv.compile<ApiIndex>(apiIndexSchema);
export const validateApiDay = ajv.compile<ApiDay>(apiDaySchema);
export const validateApiPassage = ajv.compile<ApiPassage>(apiPassageSchema);
export const validateApiPassageIndex = ajv.compile<ApiPassageIndex>(apiPassageIndexSchema);
export const validateApiCalendar = ajv.compile<ApiCalendar>(apiCalendarSchema);
export const validateApiUpcoming = ajv.compile<ApiUpcoming>(apiUpcomingSchema);
