/**
 * The regional overrides format (`calendar/overrides/<region>.json`, L-015).
 *
 * romcal computes the General Roman Calendar; a region (Kenya first) layers a list of
 * entries on top of it: add a proper celebration, remove one, change its rank or move it to
 * another date, plus romcal's transfer flags (Epiphany, Ascension, Corpus Christi on Sunday).
 * Every entry and every transfer cites a `source` and states a `confidence`; anything not
 * `confirmed` against the national Ordo waits for the owner's sign-off (L-209).
 */
import { isIsoDate } from '@lectio/shared';
import {
  JSON_SCHEMA_DIALECT,
  LITURGICAL_COLOURS,
  createAjv,
  formatErrors,
  isoDateSchema,
  nonEmptyStringSchema,
  schemaId,
  slugSchema,
  urlSchema,
} from '@lectio/schema/common';
import type { LiturgicalColour } from '@lectio/schema/common';

/** Ranks an override can give a celebration (a commemoration is never declared, only derived). */
export const OVERRIDE_RANKS = ['solemnity', 'feast', 'memorial', 'optional-memorial'] as const;
export type OverrideRank = (typeof OVERRIDE_RANKS)[number];

/**
 * How sure the entry is: `confirmed` against the national Ordo; `probable` from a reliable
 * secondary source; `uncertain` needs checking. Only `confirmed` entries skip sign-off (L-209).
 */
export const CONFIDENCE_LEVELS = ['confirmed', 'probable', 'uncertain'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const OVERRIDE_ACTIONS = ['add', 'remove', 'rank', 'move'] as const;
export type OverrideAction = (typeof OVERRIDE_ACTIONS)[number];

/** romcal's transfer options that a region sets (see `GenerateOptions`). */
export const TRANSFER_FLAGS = ['epiphanyOnSunday', 'ascensionOnSunday', 'corpusChristiOnSunday'] as const;
export type TransferFlag = (typeof TRANSFER_FLAGS)[number];

export interface OverrideSource {
  /** What the source is, e.g. `GCatholic.org, Liturgical Calendar — Kenya (2026)`. */
  readonly title: string;
  readonly url: string;
  /** When the source was read (`YYYY-MM-DD`). */
  readonly accessed: string;
}

interface Cited {
  readonly source: OverrideSource;
  readonly confidence: Confidence;
  /** Why the entry exists or what is uncertain about it. */
  readonly notes?: string;
}

/** A proper celebration on a fixed date (`MM-DD`). */
export interface AddEntry extends Cited {
  readonly action: 'add';
  /** New Lectio celebration id; must not clash with a romcal id. */
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly rank: OverrideRank;
  /** Permitted colours, the preferred first. */
  readonly colours: readonly LiturgicalColour[];
  readonly holyDayOfObligation?: boolean;
}

/** Drop a romcal celebration (by Lectio id) from the region's calendar. */
export interface RemoveEntry extends Cited {
  readonly action: 'remove';
  readonly id: string;
}

/** Give a romcal celebration another rank in the region. */
export interface RankEntry extends Cited {
  readonly action: 'rank';
  readonly id: string;
  readonly rank: OverrideRank;
  /** Colours to use instead of the celebration's own (needed if romcal reports it as a commemoration). */
  readonly colours?: readonly LiturgicalColour[];
}

/** Celebrate a romcal celebration on another fixed date (`MM-DD`). */
export interface MoveEntry extends Cited {
  readonly action: 'move';
  readonly id: string;
  readonly date: string;
  readonly colours?: readonly LiturgicalColour[];
}

export type OverrideEntry = AddEntry | RemoveEntry | RankEntry | MoveEntry;

export interface TransferSetting extends Cited {
  readonly value: boolean;
}

export interface RegionalOverrides {
  /** Region slug, matching `site.region` in `lectio.config.json` (e.g. `kenya`). */
  readonly region: string;
  readonly description: string;
  readonly transfers: Partial<Readonly<Record<TransferFlag, TransferSetting>>>;
  readonly entries: readonly OverrideEntry[];
}

const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'url', 'accessed'],
  properties: { title: nonEmptyStringSchema, url: urlSchema, accessed: isoDateSchema },
} as const;

const cited = {
  source: sourceSchema,
  confidence: { type: 'string', enum: CONFIDENCE_LEVELS },
  notes: nonEmptyStringSchema,
} as const;
const citedRequired = ['source', 'confidence'] as const;

/** `MM-DD`; whether the day exists (`02-30`) is checked by `parseOverrides`. */
const monthDaySchema = { type: 'string', pattern: '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' } as const;
const coloursSchema = {
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: { type: 'string', enum: LITURGICAL_COLOURS },
} as const;
const rankSchema = { type: 'string', enum: OVERRIDE_RANKS } as const;

const entrySchema = {
  type: 'object',
  required: ['action', 'id', ...citedRequired],
  properties: { action: { type: 'string', enum: OVERRIDE_ACTIONS } },
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'date', 'rank', 'colours'],
      properties: {
        action: { const: 'add' },
        id: slugSchema,
        name: nonEmptyStringSchema,
        date: monthDaySchema,
        rank: rankSchema,
        colours: coloursSchema,
        holyDayOfObligation: { type: 'boolean' },
        ...cited,
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: { action: { const: 'remove' }, id: slugSchema, ...cited },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['rank'],
      properties: { action: { const: 'rank' }, id: slugSchema, rank: rankSchema, colours: coloursSchema, ...cited },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['date'],
      properties: { action: { const: 'move' }, id: slugSchema, date: monthDaySchema, colours: coloursSchema, ...cited },
    },
  ],
} as const;

const transferSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['value', ...citedRequired],
  properties: { value: { type: 'boolean' }, ...cited },
} as const;

export const regionalOverridesSchema = {
  $schema: JSON_SCHEMA_DIALECT,
  $id: schemaId('calendar-overrides'),
  title: 'Lectio regional calendar overrides',
  description:
    'Changes a region makes to the General Roman Calendar computed by romcal (calendar/overrides/<region>.json). ' +
    'Every entry cites a source.',
  type: 'object',
  additionalProperties: false,
  required: ['region', 'description', 'transfers', 'entries'],
  properties: {
    region: slugSchema,
    description: nonEmptyStringSchema,
    transfers: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(TRANSFER_FLAGS.map((flag) => [flag, transferSchema])),
    },
    entries: { type: 'array', items: entrySchema },
  },
} as const;

const validate = createAjv().compile(regionalOverridesSchema);

/** Thrown by `parseOverrides`; `problems` lists every error found. */
export class OverridesError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid regional overrides:\n${problems.map((p) => `  ${p}`).join('\n')}`);
    this.name = 'OverridesError';
    this.problems = problems;
  }
}

/** True for a real `MM-DD` in some year (`02-29` is real; it is skipped in common years). */
export function isMonthDay(value: string): boolean {
  return isIsoDate(`2000-${value}`);
}

/**
 * Checks that the schema cannot express: each date exists, and each celebration id is the
 * subject of at most one entry (two entries for one id would depend on their order).
 */
function semanticProblems(overrides: RegionalOverrides): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  overrides.entries.forEach((entry, index) => {
    if (seen.has(entry.id)) problems.push(`/entries/${String(index)} more than one entry for ${entry.id}`);
    seen.add(entry.id);
    if ((entry.action === 'add' || entry.action === 'move') && !isMonthDay(entry.date)) {
      problems.push(`/entries/${String(index)}/date ${entry.date} is not a day of the year`);
    }
  });
  return problems;
}

/** Validate parsed JSON as regional overrides; throws `OverridesError` listing every problem. */
export function parseOverrides(value: unknown): RegionalOverrides {
  if (!validate(value)) throw new OverridesError(formatErrors(validate.errors));
  const overrides = value as unknown as RegionalOverrides;
  const problems = semanticProblems(overrides);
  if (problems.length > 0) throw new OverridesError(problems);
  return overrides;
}

/** Entries and transfers that are not `confirmed` and need the owner's sign-off (L-209). */
export function pendingSignOff(overrides: RegionalOverrides): string[] {
  const transfers = TRANSFER_FLAGS.filter((flag) => {
    const setting = overrides.transfers[flag];
    return setting !== undefined && setting.confidence !== 'confirmed';
  });
  const entries = overrides.entries.filter((entry) => entry.confidence !== 'confirmed');
  return [...transfers.map((flag) => `transfer ${flag}`), ...entries.map((entry) => `${entry.action} ${entry.id}`)];
}
