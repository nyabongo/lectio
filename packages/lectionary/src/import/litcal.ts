/**
 * Import from the Liturgical Calendar API lectionary corpus (Apache-2.0), pinned by commit in
 * `calendar/lectionary/sources.json` (011, decision 2).
 *
 * A manifest (`calendar/lectionary/import/litcal/<name>.json`) lists which LitCal leaves feed which
 * Lectio entries. Each LitCal string becomes a reading whose `ref` is canonical and letter-free, whose
 * `printed` keeps LitCal's spelling, and whose `source` names the pinned revision and the leaf;
 * `a|b` becomes `ref` a with alternative b. Every imported reading is `provisional`.
 *
 * The network call goes through the injected {@link TextFetcher}; tests pass a fake.
 */
import type { ReadingSlot } from '@lectio/schema/common';
import { READING_SLOTS } from '@lectio/schema/common';
import type { RefError } from '@lectio/refs';

import { canonicalRef } from '../canonical.ts';
import { compareKeys } from '../keys.ts';
import { locatorRegExp } from '../sources.ts';
import { CYCLES, ENTRY_KINDS } from '../types.ts';
import type { Alternative, BlockFile, Cycle, Entry, EntryKind, MassEntry, Reading, SourceRegistry } from '../types.ts';

/** Fetches the text behind a URL; implementations throw on HTTP or network errors. */
export interface TextFetcher {
  fetchText(url: string): Promise<string>;
}

export interface LitcalImport {
  readonly key: string;
  /** Lectio Mass id; defaults to `day`. */
  readonly mass?: string;
  readonly cycle?: Cycle;
  /** A `litcal` locator: `<dir>/en.json#<Key>[.<mass>]`. */
  readonly locator: string;
}

export interface LitcalManifest {
  /** The block and file (relative to `calendar/lectionary/`) the readings are merged into. */
  readonly target: string;
  readonly kind: EntryKind;
  readonly imports: readonly LitcalImport[];
}

export interface ImportedReading {
  readonly key: string;
  readonly mass: string;
  readonly reading: Reading;
}

/** LitCal slot names → Lectio slots. Gospel acclamations are not readings and are skipped. */
const SLOTS: Readonly<Record<string, ReadingSlot | null>> = {
  first_reading: 'first-reading',
  responsorial_psalm: 'psalm',
  second_reading: 'second-reading',
  gospel: 'gospel',
  gospel_acclamation: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shape check of a parsed manifest. */
export function parseManifest(json: unknown, label: string): { data?: LitcalManifest; problems: string[] } {
  if (!isRecord(json) || typeof json['target'] !== 'string' || !Array.isArray(json['imports'])) {
    return { problems: [`${label}: expected { "target", "kind", "imports": [...] }`] };
  }
  const problems: string[] = [];
  if (!/^[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(json['target']))
    problems.push(`${label}: target must be <block>/<file>.json`);
  if (!ENTRY_KINDS.includes(json['kind'] as EntryKind))
    problems.push(`${label}: kind must be one of ${ENTRY_KINDS.join(', ')}`);
  json['imports'].forEach((item: unknown, i) => {
    const ok =
      isRecord(item) &&
      typeof item['key'] === 'string' &&
      typeof item['locator'] === 'string' &&
      (item['mass'] === undefined || typeof item['mass'] === 'string') &&
      (item['cycle'] === undefined || CYCLES.includes(item['cycle'] as Cycle));
    if (!ok) problems.push(`${label} imports[${i}]: expected { "key", "locator", "mass"?, "cycle"? }`);
  });
  return problems.length === 0 ? { data: json as unknown as LitcalManifest, problems } : { problems };
}

function toReading(slot: ReadingSlot, text: string, cycle: Cycle | undefined, source: string): Reading {
  const [first, ...rest] = text.split('|').map((part) => part.trim());
  const alternatives: Alternative[] = rest.map((printed) => ({ ref: canonicalRef(printed), printed }));
  const printed = first as string;
  return {
    slot,
    ...(cycle === undefined ? {} : { cycle }),
    ref: canonicalRef(printed),
    printed,
    ...(alternatives.length === 0 ? {} : { alternatives }),
    source,
    status: 'provisional',
  };
}

/** Fetches the manifest's LitCal files at the pinned revision and converts the listed leaves. */
export async function importLitcal(
  manifest: LitcalManifest,
  registry: SourceRegistry,
  fetcher: TextFetcher,
): Promise<{ readings: ImportedReading[]; problems: string[] }> {
  const info = registry.sources['litcal'];
  if (info?.pinned === undefined || info.retrieval === undefined) {
    return { readings: [], problems: ['sources.json: litcal needs "pinned" and "retrieval"'] };
  }
  const { pinned, retrieval } = info;
  const base = retrieval.replace('{rev}', pinned);
  const pattern = locatorRegExp(info);
  const files = new Map<string, Promise<unknown>>();
  const readings: ImportedReading[] = [];
  const problems: string[] = [];

  for (const item of manifest.imports) {
    const at = `${item.key} ← ${item.locator}`;
    if (!pattern.test(item.locator)) {
      problems.push(`${at}: not a litcal locator`);
      continue;
    }
    const [path, anchor] = item.locator.split('#') as [string, string];
    const [leafKey, massKey] = anchor.split('.') as [string, string | undefined];
    const url = `${base}${path.startsWith('decrees/') ? '' : 'lectionary/'}${path}`;
    if (!files.has(url))
      files.set(
        url,
        fetcher.fetchText(url).then((text) => JSON.parse(text) as unknown),
      );
    let leaf: unknown;
    try {
      const json = await (files.get(url) as Promise<unknown>);
      leaf = isRecord(json) ? json[leafKey] : undefined;
      if (massKey !== undefined) leaf = isRecord(leaf) ? leaf[massKey] : undefined;
    } catch (error) {
      problems.push(`${at}: ${(error as Error).message}`);
      continue;
    }
    if (!isRecord(leaf)) {
      problems.push(`${at}: no such leaf in ${path}`);
      continue;
    }
    const source = `litcal@${pinned} ${item.locator}`;
    const found: Reading[] = [];
    for (const [name, value] of Object.entries(leaf)) {
      const slot = SLOTS[name];
      if (slot === undefined) problems.push(`${at}: unknown LitCal slot "${name}"`);
      if (!slot || typeof value !== 'string' || value.trim() === '') continue;
      try {
        found.push(toReading(slot, value, item.cycle, source));
      } catch (error) {
        // canonicalRef throws only RefError.
        problems.push(`${at} ${name}: ${(error as RefError).message}`);
      }
    }
    if (found.length === 0) problems.push(`${at}: the leaf has no readings`);
    for (const reading of found) readings.push({ key: item.key, mass: item.mass ?? 'day', reading });
  }
  return { readings, problems };
}

function readingOrder(a: Reading, b: Reading): number {
  const slot = READING_SLOTS.indexOf(a.slot) - READING_SLOTS.indexOf(b.slot);
  return slot !== 0 ? slot : CYCLES.indexOf(a.cycle as Cycle) - CYCLES.indexOf(b.cycle as Cycle);
}

export interface MergeResult {
  readonly data: BlockFile;
  readonly added: number;
  readonly replaced: number;
  /** Readings left alone because a person verified or disputed them, or another source supplies them. */
  readonly kept: readonly string[];
  /** Provisional LitCal readings dropped because the leaf they came from no longer has them. */
  readonly removed: readonly string[];
}

const readingId = (key: string, mass: string, reading: Reading): string =>
  `${key} ${mass} ${reading.slot}${reading.cycle === undefined ? '' : ` (${reading.cycle})`}`;

/** The locator of a `litcal@<rev> <locator>` source. */
const locatorOf = (source: string): string => source.slice(source.indexOf(' ') + 1);

const isLitcalImport = (reading: Reading): boolean =>
  reading.status === 'provisional' && reading.source.startsWith('litcal@');

/**
 * Merges imported readings into a data file. A reading (same key, Mass, slot and cycle) is replaced
 * only when it is a provisional LitCal import; anything verified, disputed or from another source
 * is kept and reported. A provisional LitCal reading of a key and Mass that was imported again from
 * the same leaf, but that the leaf no longer supplies, is removed and reported. Entries are sorted by
 * key, readings by slot and cycle.
 */
export function mergeImported(file: BlockFile, imported: readonly ImportedReading[]): MergeResult {
  interface DraftMass {
    label?: string;
    readings: Reading[];
  }
  const entries = new Map<string, { key: string; common?: string; masses: Map<string, DraftMass> }>();
  for (const entry of file.entries) {
    const masses = new Map<string, DraftMass>(
      entry.masses.map((m) => [
        m.id,
        { ...(m.label === undefined ? {} : { label: m.label }), readings: [...m.readings] },
      ]),
    );
    entries.set(entry.key, { key: entry.key, ...(entry.common === undefined ? {} : { common: entry.common }), masses });
  }
  let added = 0;
  let replaced = 0;
  const kept: string[] = [];
  const removed: string[] = [];
  const supplied = new Set(imported.map(({ key, mass, reading }) => readingId(key, mass, reading)));
  const leaves = new Set(imported.map(({ key, mass, reading }) => `${key} ${mass} ${locatorOf(reading.source)}`));
  for (const entry of entries.values()) {
    for (const [id, mass] of entry.masses) {
      mass.readings = mass.readings.filter((reading) => {
        const stale =
          isLitcalImport(reading) &&
          leaves.has(`${entry.key} ${id} ${locatorOf(reading.source)}`) &&
          !supplied.has(readingId(entry.key, id, reading));
        if (stale) removed.push(readingId(entry.key, id, reading));
        return !stale;
      });
    }
  }
  for (const { key, mass, reading } of imported) {
    const entry = entries.get(key) ?? { key, masses: new Map<string, DraftMass>() };
    entries.set(key, entry);
    const target: DraftMass = entry.masses.get(mass) ?? { readings: [] };
    entry.masses.set(mass, target);
    const index = target.readings.findIndex((r) => r.slot === reading.slot && r.cycle === reading.cycle);
    const existing = target.readings[index];
    if (existing === undefined) {
      target.readings.push(reading);
      added += 1;
    } else if (isLitcalImport(existing)) {
      target.readings[index] = reading;
      replaced += 1;
    } else {
      kept.push(readingId(key, mass, reading));
    }
  }
  const sorted: Entry[] = [...entries.values()]
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ key, common, masses }) => ({
      key,
      ...(common === undefined ? {} : { common }),
      masses: [...masses].map(([id, { label, readings }]): MassEntry => ({
        id,
        ...(label === undefined ? {} : { label }),
        readings: [...readings].sort(readingOrder),
      })),
    }));
  return { data: { kind: file.kind, entries: sorted }, added, replaced, kept, removed };
}

/** Serialises a data file the way it is committed (two-space JSON, LF, trailing newline). */
export function serialiseBlockFile(file: BlockFile, comment?: string): string {
  return `${JSON.stringify(comment === undefined ? file : { $comment: comment, ...file }, null, 2)}\n`;
}
