/**
 * Import from the Liturgical Calendar API lectionary corpus (Apache-2.0), pinned by commit in
 * `calendar/lectionary/sources.json` (011, decision 2).
 *
 * A manifest (`calendar/lectionary/import/litcal/<name>.json`) lists which LitCal leaves feed which
 * Lectio entries. Each LitCal string becomes a reading whose `ref` is canonical and letter-free, whose
 * `printed` keeps LitCal's spelling, and whose `source` names the pinned revision and the leaf;
 * `a|b` becomes `ref` a with alternative b. Every imported reading is `provisional`.
 *
 * Every reading takes the import's `cycle`, except the slots listed in `shared` (the weekday gospel,
 * read in Years I and II alike), which are imported without one so that re-imports do not add
 * `gospel (II)` duplicates. Palm Sunday's `palm_gospel` becomes the gospel of the `procession` Mass;
 * an Easter Vigil leaf (`third_reading`, `responsorial_psalm_2`, `epistle`, …) maps to `reading-1`…,
 * `psalm-1`…, `epistle`, and the psalm after the epistle to the next psalm number (`psalm-8`).
 * LitCal's dual psalm numbers (`Psalm 66 (67)`) are read as the Hebrew one (canonical.ts).
 *
 * The import fails rather than guess: a manifest with unknown properties, an import key that is not a
 * key of the target's kind, or a Mass sub-leaf (`<Key>.<mass>`) that LitCal does not have is a
 * problem. A Mass LitCal really dropped is confirmed with `"removed": true` on its import, which drops
 * its provisional readings on merge.
 *
 * The network call goes through the injected {@link TextFetcher}; tests pass a fake.
 */
import type { ReadingSlot } from '@lectio/schema/common';
import { READING_SLOTS } from '@lectio/schema/common';
import type { RefError } from '@lectio/refs';

import { canonicalRef } from '../canonical.ts';
import { PROPER_OF_TIME_KEY, SLUG, compareKeys } from '../keys.ts';
import { slotRanker } from '../slots.ts';
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
  /** Slots imported without `cycle` (shared by every cycle); defaults to the manifest's `shared`. */
  readonly shared?: readonly ReadingSlot[];
  /** A `litcal` locator: `<dir>/en.json#<Key>[.<mass>]`. */
  readonly locator: string;
  /**
   * Confirms that LitCal dropped the Mass sub-leaf the locator names: its provisional readings are
   * removed on merge. Without it, a missing sub-leaf fails the import (a typo must not delete data).
   */
  readonly removed?: boolean;
}

export interface LitcalManifest {
  /** The block and file (relative to `calendar/lectionary/`) the readings are merged into. */
  readonly target: string;
  readonly kind: EntryKind;
  /** Slots every import brings in without its `cycle`, e.g. `["gospel"]` for Ordinary Time weekdays. */
  readonly shared?: readonly ReadingSlot[];
  readonly imports: readonly LitcalImport[];
}

export interface ImportedReading {
  readonly key: string;
  readonly mass: string;
  readonly reading: Reading;
}

/** A Mass whose LitCal leaf (`<Key>.<mass>`) is gone while its parent leaf is still there. */
export interface RemovedMass {
  readonly key: string;
  readonly mass: string;
  readonly locator: string;
}

/** LitCal slot names → Lectio slots. Gospel acclamations are not readings and are skipped. */
const SLOTS: Readonly<Record<string, ReadingSlot | null>> = {
  first_reading: 'first-reading',
  responsorial_psalm: 'psalm',
  second_reading: 'second-reading',
  gospel: 'gospel',
  gospel_acclamation: null,
};

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];

/** A leaf of numbered readings (the Easter Vigil): it has a third reading, a numbered psalm or an epistle. */
function isVigilLeaf(leaf: Record<string, unknown>): boolean {
  return Object.keys(leaf).some((name) => name === 'third_reading' || name === 'epistle' || /_\d$/.test(name));
}

/**
 * Where a LitCal slot goes: a Lectio slot and, for the palm gospel, the `procession` Mass; `null` to
 * skip it (gospel acclamations); `undefined` when the name is unknown.
 */
function mapSlot(
  name: string,
  vigil: boolean,
  readings: number,
): { slot: ReadingSlot; mass?: string } | null | undefined {
  if (name === 'palm_gospel') return { slot: 'gospel', mass: 'procession' };
  if (!vigil || name === 'gospel' || name === 'gospel_acclamation') {
    const slot = SLOTS[name];
    return slot === undefined || slot === null ? slot : { slot };
  }
  if (name === 'epistle') return { slot: 'epistle' };
  const reading = /^([a-z]+)_reading$/.exec(name);
  const psalm = /^responsorial_psalm(?:_(\d|epistle))?$/.exec(name);
  let slot: string | undefined;
  if (reading !== null && ORDINALS.includes(reading[1] as string)) {
    slot = `reading-${String(ORDINALS.indexOf(reading[1] as string) + 1)}`;
  } else if (psalm !== null) {
    const n = psalm[1] === undefined ? '1' : psalm[1] === 'epistle' ? String(readings + 1) : psalm[1];
    slot = `psalm-${n}`;
  }
  return slot !== undefined && (READING_SLOTS as readonly string[]).includes(slot)
    ? { slot: slot as ReadingSlot }
    : undefined;
}

const MANIFEST_PROPERTIES = new Set(['$comment', 'target', 'kind', 'shared', 'imports']);
const IMPORT_PROPERTIES = new Set(['key', 'locator', 'mass', 'cycle', 'shared', 'removed']);

/** Properties of `record` that `allowed` does not list, quoted, for a message. */
function unknownProperties(record: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(record)
    .filter((name) => !allowed.has(name))
    .map((name) => `"${name}"`);
}

/** Whether `key` is a key of an entry of `kind` (types.ts): a proper-of-time key, else a slug. */
function isEntryKey(kind: unknown, key: string): boolean {
  return kind === 'proper-of-time' ? PROPER_OF_TIME_KEY.test(key) : SLUG.test(key);
}

const isSlotList = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.every((slot) => (READING_SLOTS as readonly unknown[]).includes(slot)));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shape check of a parsed manifest: unknown properties and keys that do not fit the kind are problems. */
export function parseManifest(json: unknown, label: string): { data?: LitcalManifest; problems: string[] } {
  if (!isRecord(json) || typeof json['target'] !== 'string' || !Array.isArray(json['imports'])) {
    return { problems: [`${label}: expected { "target", "kind", "imports": [...] }`] };
  }
  const problems: string[] = [];
  if (!/^[a-z0-9-]+\/[a-z0-9-]+\.json$/.test(json['target']))
    problems.push(`${label}: target must be <block>/<file>.json`);
  if (!ENTRY_KINDS.includes(json['kind'] as EntryKind))
    problems.push(`${label}: kind must be one of ${ENTRY_KINDS.join(', ')}`);
  if (!isSlotList(json['shared'])) problems.push(`${label}: shared must be an array of reading slots`);
  const unknown = unknownProperties(json, MANIFEST_PROPERTIES);
  if (unknown.length > 0) problems.push(`${label}: unknown properties ${unknown.join(', ')}`);
  json['imports'].forEach((item: unknown, i) => {
    const ok =
      isRecord(item) &&
      typeof item['key'] === 'string' &&
      typeof item['locator'] === 'string' &&
      (item['mass'] === undefined || typeof item['mass'] === 'string') &&
      (item['cycle'] === undefined || CYCLES.includes(item['cycle'] as Cycle)) &&
      (item['removed'] === undefined || typeof item['removed'] === 'boolean') &&
      isSlotList(item['shared']);
    if (!ok) {
      problems.push(`${label} imports[${i}]: expected { "key", "locator", "mass"?, "cycle"?, "shared"?, "removed"? }`);
      return;
    }
    const extra = unknownProperties(item, IMPORT_PROPERTIES);
    if (extra.length > 0) problems.push(`${label} imports[${i}]: unknown properties ${extra.join(', ')}`);
    const key = item['key'] as string;
    if (!isEntryKey(json['kind'], key))
      problems.push(`${label} imports[${i}]: "${key}" is not a ${String(json['kind'])} key`);
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

export interface LitcalImportResult {
  readonly readings: ImportedReading[];
  /** Masses confirmed gone from LitCal (`"removed": true`); `mergeImported` drops their readings. */
  readonly removedMasses: RemovedMass[];
  readonly problems: string[];
}

/** What a shared slot must agree on across imports: the reference, its printed form and its alternatives. */
function sharedSignature(reading: Reading): string {
  const { ref, printed, alternatives = [] } = reading;
  return JSON.stringify([ref, printed, alternatives.map((alt) => [alt.ref, alt.printed])]);
}

/** A reading for a conflict message, as LitCal prints it (`a | b`); imported readings always keep `printed`. */
function describe(reading: Reading): string {
  return [reading, ...(reading.alternatives ?? [])].map((part) => String(part.printed)).join(' | ');
}

/**
 * Fetches the manifest's LitCal files at the pinned revision and converts the listed leaves. A
 * shared slot that two imports of one celebration (key), Mass and slot give differently (ref, printed
 * form or alternatives) is a problem, and so is a Mass sub-leaf LitCal does not have, unless the
 * import confirms it with `"removed": true`.
 */
export async function importLitcal(
  manifest: LitcalManifest,
  registry: SourceRegistry,
  fetcher: TextFetcher,
): Promise<LitcalImportResult> {
  const info = registry.sources['litcal'];
  if (info?.pinned === undefined || info.retrieval === undefined) {
    return { readings: [], removedMasses: [], problems: ['sources.json: litcal needs "pinned" and "retrieval"'] };
  }
  const { pinned, retrieval } = info;
  const base = retrieval.replace('{rev}', pinned);
  const pattern = locatorRegExp(info);
  const files = new Map<string, Promise<unknown>>();
  const readings: ImportedReading[] = [];
  const removedMasses: RemovedMass[] = [];
  const problems: string[] = [];
  const sharedReadings = new Map<string, Reading>();

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
    let parent: unknown;
    try {
      const json = await (files.get(url) as Promise<unknown>);
      leaf = isRecord(json) ? json[leafKey] : undefined;
      parent = leaf;
      if (massKey !== undefined) leaf = isRecord(leaf) ? leaf[massKey] : undefined;
    } catch (error) {
      problems.push(`${at}: ${(error as Error).message}`);
      continue;
    }
    const mass = item.mass ?? 'day';
    if (leaf === undefined && massKey !== undefined && isRecord(parent)) {
      if (item.removed === true) removedMasses.push({ key: item.key, mass, locator: item.locator });
      else
        problems.push(
          `${at}: ${leafKey} in ${path} has no "${massKey}" (${Object.keys(parent).join(', ')}); ` +
            'fix the locator, or set "removed": true if LitCal dropped this Mass',
        );
      continue;
    }
    if (item.removed === true) {
      problems.push(`${at}: marked "removed" but ${path} still has the leaf`);
      continue;
    }
    if (!isRecord(leaf)) {
      problems.push(`${at}: no such leaf in ${path}`);
      continue;
    }
    const source = `litcal@${pinned} ${item.locator}`;
    const shared = item.shared ?? manifest.shared ?? [];
    const vigil = isVigilLeaf(leaf);
    const numbered = Object.keys(leaf).filter((name) => /^[a-z]+_reading$/.test(name)).length;
    const found: ImportedReading[] = [];
    for (const [name, value] of Object.entries(leaf)) {
      const target = mapSlot(name, vigil, numbered);
      if (target === undefined) problems.push(`${at}: unknown LitCal slot "${name}"`);
      if (!target || typeof value !== 'string' || value.trim() === '') continue;
      const cycle = shared.includes(target.slot) ? undefined : item.cycle;
      try {
        found.push({ key: item.key, mass: target.mass ?? mass, reading: toReading(target.slot, value, cycle, source) });
      } catch (error) {
        // canonicalRef throws only RefError.
        problems.push(`${at} ${name}: ${(error as RefError).message}`);
      }
    }
    if (found.length === 0) problems.push(`${at}: the leaf has no readings`);
    for (const imported of found) {
      const { reading } = imported;
      if (shared.includes(reading.slot)) {
        const id = `${imported.key} ${imported.mass} ${reading.slot}`;
        const earlier = sharedReadings.get(id);
        if (earlier !== undefined && sharedSignature(earlier) !== sharedSignature(reading)) {
          problems.push(
            `${at}: shared ${reading.slot} "${describe(reading)}" differs from "${describe(earlier)}" imported for ${id}`,
          );
        }
        sharedReadings.set(id, reading);
      }
      readings.push(imported);
    }
  }
  return { readings, removedMasses, problems };
}

function readingOrder(rank: (slot: ReadingSlot) => number): (a: Reading, b: Reading) => number {
  return (a, b) => {
    const slot = rank(a.slot) - rank(b.slot);
    return slot !== 0 ? slot : CYCLES.indexOf(a.cycle as Cycle) - CYCLES.indexOf(b.cycle as Cycle);
  };
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
 * is kept and reported. A provisional LitCal reading of a key that was imported again from the same
 * leaf (whatever its Mass), but that the leaf no longer supplies, is removed and reported, and so are
 * the provisional LitCal readings of a Mass whose leaf LitCal removed (`removedMasses`). A Mass left
 * without readings is dropped, and so is an entry left without Masses or a common. Entries are sorted
 * by key, readings in proclamation order (slots.ts) and by cycle.
 */
export function mergeImported(
  file: BlockFile,
  imported: readonly ImportedReading[],
  removedMasses: readonly RemovedMass[] = [],
): MergeResult {
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
  const leaves = new Set(imported.map(({ key, reading }) => `${key} ${locatorOf(reading.source)}`));
  const gone = new Set(removedMasses.map(({ key, mass, locator }) => `${key} ${mass} ${locator}`));
  for (const entry of entries.values()) {
    for (const [id, mass] of entry.masses) {
      const before = mass.readings.length;
      mass.readings = mass.readings.filter((reading) => {
        const locator = locatorOf(reading.source);
        const stale =
          isLitcalImport(reading) &&
          ((leaves.has(`${entry.key} ${locator}`) && !supplied.has(readingId(entry.key, id, reading))) ||
            gone.has(`${entry.key} ${id} ${locator}`));
        if (stale) removed.push(readingId(entry.key, id, reading));
        return !stale;
      });
      if (before > 0 && mass.readings.length === 0) entry.masses.delete(id);
    }
    if (entry.masses.size === 0 && entry.common === undefined) entries.delete(entry.key);
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
        readings: [...readings].sort(readingOrder(slotRanker(readings.map((r) => r.slot)))),
      })),
    }));
  return { data: { kind: file.kind, entries: sorted }, added, replaced, kept, removed };
}

/** Serialises a data file the way it is committed (two-space JSON, LF, trailing newline). */
export function serialiseBlockFile(file: BlockFile, comment?: string): string {
  return `${JSON.stringify(comment === undefined ? file : { $comment: comment, ...file }, null, 2)}\n`;
}
