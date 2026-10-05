/**
 * Calendar year schema (`calendar/<year>.json`): for every date, the liturgical day, its
 * celebrations and the Masses with their readings by reference and link-out. Built by
 * `npm run calendar:build` (L-017); never contains reading text.
 *
 * Cross-item rules (dates unique, sorted, all inside `year`; keys match refs) belong to
 * `calendar:check` and gate 1, not to this schema.
 */
import type { FromSchema } from 'json-schema-to-ts';

import {
  JSON_SCHEMA_DIALECT,
  createAjv,
  isoDateSchema,
  liturgicalColourSchema,
  nonEmptyStringSchema,
  passageKeySchema,
  readingSlotSchema,
  schemaId,
  slugSchema,
  urlSchema,
} from '../common/index.ts';

/** Liturgical seasons of the General Roman Calendar. */
export const SEASONS = ['advent', 'christmas', 'ordinary-time', 'lent', 'paschal-triduum', 'easter'] as const;

/** Celebration ranks, from highest to lowest (romcal's ranks in kebab-case). */
export const CELEBRATION_RANKS = [
  'solemnity',
  'sunday',
  'feast',
  'memorial',
  'optional-memorial',
  'commemoration',
  'weekday',
] as const;

/** Sunday lectionary cycle (three years) and weekday cycle (two years). */
export const SUNDAY_CYCLES = ['A', 'B', 'C'] as const;
export const WEEKDAY_CYCLES = ['I', 'II'] as const;

const readingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slot', 'ref', 'key', 'linkout'],
  properties: {
    slot: readingSlotSchema,
    /** Lectionary-style reference, letters kept (`Mt 20:1-16a`). */
    ref: nonEmptyStringSchema,
    key: passageKeySchema,
    /** Where the reader taps through to read the text. */
    linkout: urlSchema,
  },
} as const;

const massSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'readings'],
  properties: {
    id: slugSchema,
    label: nonEmptyStringSchema,
    readings: { type: 'array', items: readingSchema },
  },
} as const;

/**
 * Review status of a translated name (L-111): `provisional` (drafted, not yet reviewed by a native
 * speaker), `reviewed`, or `fallback` (no translation: the field holds the English name).
 */
export const NAME_STATUSES = ['provisional', 'reviewed', 'fallback'] as const;

/**
 * A celebration's name in each calendar language (L-111). `en` repeats `name`; `sw` is the Kiswahili
 * name from `calendar/i18n/sw.json`, or the English name when `swStatus` is `fallback`. `swStatus`
 * is optional so earlier files stay valid; `calendar:build` always writes it.
 */
const celebrationNamesSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['en', 'sw'],
  properties: {
    en: nonEmptyStringSchema,
    sw: nonEmptyStringSchema,
    swStatus: { type: 'string', enum: NAME_STATUSES },
  },
} as const;

const celebrationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'rank', 'colour'],
  properties: {
    id: slugSchema,
    /** English name (romcal's, or the regional override's). */
    name: nonEmptyStringSchema,
    /** Optional so files built before L-111 stay valid; `calendar:build` always writes it. */
    names: celebrationNamesSchema,
    rank: { type: 'string', enum: CELEBRATION_RANKS },
    colour: liturgicalColourSchema,
  },
} as const;

/**
 * One date. When the lectionary data is present (`lectionaryMissing: false`) the day has at least one
 * Mass, unless it is a day without any Mass (`noMass: true`, Holy Saturday): then `masses` is empty
 * and the data is not missing.
 */
const daySchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'date',
    'season',
    'seasonWeek',
    'sundayCycle',
    'weekdayCycle',
    'celebrations',
    'masses',
    'lectionaryMissing',
  ],
  properties: {
    date: isoDateSchema,
    season: { type: 'string', enum: SEASONS },
    /** Week of the season; 0 for the days before the first Sunday of a season (e.g. Ash Wednesday). */
    seasonWeek: { type: 'integer', minimum: 0, maximum: 34 },
    sundayCycle: { type: 'string', enum: SUNDAY_CYCLES },
    weekdayCycle: { type: 'string', enum: WEEKDAY_CYCLES },
    celebrations: { type: 'array', minItems: 1, items: celebrationSchema },
    masses: { type: 'array', items: massSchema },
    lectionaryMissing: { type: 'boolean' },
    /**
     * The day has no Mass at all (Holy Saturday: the Easter Vigil belongs to Easter Sunday). Written
     * only when true; absent means false, so earlier files stay valid.
     */
    noMass: { type: 'boolean' },
  },
  allOf: [
    {
      if: { properties: { lectionaryMissing: { const: false }, noMass: { const: false } } },
      then: { properties: { masses: { type: 'array', minItems: 1 } } },
    },
    {
      if: { required: ['noMass'], properties: { noMass: { const: true } } },
      then: { properties: { masses: { type: 'array', maxItems: 0 }, lectionaryMissing: { const: false } } },
    },
  ],
} as const;

export const calendarYearSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('calendar-year'),
  title: 'Lectio calendar year',
  description:
    'Liturgical calendar for one civil year (calendar/<year>.json): celebrations and readings by reference ' +
    'and link-out. Never contains the reading text.',
  type: 'object',
  additionalProperties: false,
  required: ['year', 'region', 'generatedBy', 'days'],
  properties: {
    year: { type: 'integer', minimum: 1970, maximum: 9999 },
    /** Calendar region slug, e.g. `kenya` (romcal calendar plus overrides). */
    region: slugSchema,
    /** What built the file, e.g. `@lectio/calendar 0.1.0 (romcal 3.0.0)`. */
    generatedBy: nonEmptyStringSchema,
    days: { type: 'array', items: daySchema },
  },
} as const;

export type CalendarYear = FromSchema<typeof calendarYearSchema>;
export type CalendarDay = CalendarYear['days'][number];
export type Celebration = CalendarDay['celebrations'][number];
export type Mass = CalendarDay['masses'][number];
export type Reading = Mass['readings'][number];

/** ajv validator for a calendar year file; on failure, `validateCalendarYear.errors` lists every problem. */
export const validateCalendarYear = createAjv().compile<CalendarYear>(calendarYearSchema);
