/**
 * The lectionary reference-data format (docs/decisions/011-lectionary-source.md).
 *
 * Data lives in `calendar/lectionary/<block>/*.json`. Each file holds one kind of entry:
 *
 * - `proper-of-time`: keyed by season, week and weekday (`ot-sunday-25`, `ot-weekday-25-tue`);
 * - `celebrations`: keyed by the Lectio celebration id (`matthew-apostle`), for the sanctoral
 *   and for moveable solemnities and feasts;
 * - `commons`: keyed by the common's id (`apostles`), used by celebrations without their own readings.
 *
 * Only citations are stored, never reading text (ADR 0003).
 */
import type { ReadingSlot } from '@lectio/schema/common';

export const ENTRY_KINDS = ['proper-of-time', 'celebrations', 'commons'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const STATUSES = ['provisional', 'verified', 'disputed'] as const;
/** `provisional` until a person checks the entry against the Kenyan book (011, decision 4). */
export type EntryStatus = (typeof STATUSES)[number];

export const SUNDAY_CYCLES = ['A', 'B', 'C'] as const;
export const WEEKDAY_CYCLES = ['I', 'II'] as const;
export type Cycle = (typeof SUNDAY_CYCLES)[number] | (typeof WEEKDAY_CYCLES)[number];
export const CYCLES: readonly Cycle[] = [...SUNDAY_CYCLES, ...WEEKDAY_CYCLES];

/** A long/short form or an "or" option, as a separate reference. */
export interface Alternative {
  /** Canonical, letter-free reference (ADR 0004). */
  readonly ref: string;
  /** The citation exactly as the cited source prints it. */
  readonly printed?: string;
}

/** One reading: `{ slot, cycle?, ref, printed?, alternatives?, source, status }`. */
export interface Reading {
  readonly slot: ReadingSlot;
  /** The Sunday (A/B/C) or weekday (I/II) cycle the reading belongs to; absent when shared by every cycle. */
  readonly cycle?: Cycle;
  /** Canonical, letter-free reference in NABRE ≈ original versification (Hebrew psalm numbers). */
  readonly ref: string;
  readonly printed?: string;
  readonly alternatives?: readonly Alternative[];
  /** `<source-id>[@<revision>] <locator>`, validated against `calendar/lectionary/sources.json`. */
  readonly source: string;
  readonly status: EntryStatus;
}

/** One Mass of a day (`day`, `vigil`, `night`, `dawn`, …). */
export interface MassEntry {
  readonly id: string;
  readonly label?: string;
  readonly readings: readonly Reading[];
}

export interface Entry {
  readonly key: string;
  /** For celebrations: the common to use when the entry has no Masses of its own. */
  readonly common?: string;
  readonly masses: readonly MassEntry[];
}

/** One data file. */
export interface BlockFile {
  readonly kind: EntryKind;
  readonly entries: readonly Entry[];
}

/** A data file with where it came from. */
export interface LoadedFile {
  readonly block: string;
  /** Path relative to `calendar/lectionary/`, for messages. */
  readonly path: string;
  readonly data: BlockFile;
}

/** One entry of `calendar/lectionary/sources.json`. */
export interface SourceInfo {
  readonly title: string;
  readonly bibliography: string;
  readonly url?: string;
  readonly translation: string;
  /**
   * How the source numbers chapters, verses and psalms; `lectionary:crosscheck` converts from it to canonical.
   * `nabre`: already canonical. `vulgate`: Vulgate/LXX psalm numbers. `rsv`: RSV chapter and verse divisions.
   */
  readonly convention: Convention;
  readonly versification: string;
  readonly psalmNumbering: string;
  readonly licence: string;
  /** `none-needed` | `to-request` | `requested <date>` | `granted <date> <ref>`. */
  readonly permission: string;
  readonly automatedRetrieval: boolean;
  readonly physicalCopy: string | null;
  /** Whether a `@<revision>` is required (versioned digital source) or forbidden (print). */
  readonly revision: 'required' | 'forbidden';
  /** The pinned revision every citation of a versioned source must name. */
  readonly pinned?: string;
  /** Base URL for automated retrieval; `{rev}` is replaced by the pinned revision. */
  readonly retrieval?: string;
  /** Regular expression (without anchors) for the locator. */
  readonly locatorPattern: string;
  readonly locatorExample: string;
  readonly notes?: string;
}

export const CONVENTIONS = ['nabre', 'vulgate', 'rsv'] as const;
export type Convention = (typeof CONVENTIONS)[number];

export interface SourceRegistry {
  readonly sources: Readonly<Record<string, SourceInfo>>;
}
