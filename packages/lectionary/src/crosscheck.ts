/**
 * `lectionary:crosscheck`: compares every reading of a block with a second, independent source
 * (`calendar/lectionary/crosscheck/<block>.json`) and renders the disagreements for the owner
 * (`calendar/lectionary/disputes/<block>.md`).
 *
 * Refs are compared as canonical passage keys after converting the second source's numbering
 * (convert.ts), so verse letters and psalm numbering never cause a dispute. A reading the second
 * source does not cover is listed as single-source.
 */
import { parseRef, toKey, tryParseRef } from '@lectio/refs';

import { refKey } from './canonical.ts';
import { checkRefString } from './check.ts';
import type { ConversionError } from './convert.ts';
import { toCanonical } from './convert.ts';
import { checkSource, splitSource } from './sources.ts';
import { ENTRY_KINDS } from './types.ts';
import type { Convention, EntryKind, LoadedFile, Reading, SourceRegistry } from './types.ts';

/** One reading as the second source gives it, in that source's own numbering. */
export interface CrosscheckEntry {
  readonly kind: EntryKind;
  readonly key: string;
  readonly mass: string;
  readonly slot: string;
  readonly cycle?: string;
  readonly ref: string;
  readonly alternatives?: readonly string[];
  /** A hand conversion to canonical, for the cases convert.ts leaves to a person (Esther, Sirach, Tobit, RSV psalms). */
  readonly canonical?: string;
  readonly alternativesCanonical?: readonly string[];
  readonly source: string;
}

/** An entry the second source was consulted for and has no data on. */
export interface ConsultedEntry {
  readonly kind: EntryKind;
  readonly key: string;
  readonly source: string;
  readonly note?: string;
}

export interface CrosscheckFile {
  readonly block: string;
  readonly entries: readonly CrosscheckEntry[];
  readonly consulted?: readonly ConsultedEntry[];
}

export interface Row {
  /** `<kind>:<key> <mass> <slot>[ (<cycle>)]` */
  readonly id: string;
  readonly kind: EntryKind;
  readonly key: string;
  readonly reading: Reading;
}

export interface Disagreement {
  readonly id: string;
  readonly ours?: string;
  readonly theirs?: string;
  readonly reason: string;
}

export interface SingleSource {
  readonly id: string;
  readonly ours: string;
  readonly source: string;
  /** Second sources consulted that have no data for the entry. */
  readonly consulted: readonly string[];
}

export interface CrosscheckResult {
  readonly block: string;
  readonly compared: number;
  readonly agreements: number;
  readonly disagreements: readonly Disagreement[];
  readonly singleSource: readonly SingleSource[];
}

function rowId(kind: string, key: string, mass: string, slot: string, cycle: string | undefined): string {
  return `${kind}:${key} ${mass} ${slot}${cycle === undefined ? '' : ` (${cycle})`}`;
}

/** Every reading of the block's files. */
export function blockRows(files: readonly LoadedFile[]): Row[] {
  return files.flatMap(({ data }) =>
    data.entries.flatMap((entry) =>
      entry.masses.flatMap((mass) =>
        mass.readings.map((reading) => ({
          id: rowId(data.kind, entry.key, mass.id, reading.slot, reading.cycle),
          kind: data.kind,
          key: entry.key,
          reading,
        })),
      ),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Shape check of a parsed cross-check file. */
export function parseCrosscheckFile(json: unknown, label: string): { data?: CrosscheckFile; problems: string[] } {
  const problems: string[] = [];
  if (!isRecord(json) || typeof json['block'] !== 'string' || !Array.isArray(json['entries'])) {
    return { problems: [`${label}: expected { "block", "entries": [...], "consulted"?: [...] }`] };
  }
  json['entries'].forEach((entry: unknown, i) => {
    const at = `${label} entries[${i}]`;
    if (!isRecord(entry)) return problems.push(`${at}: must be an object`);
    for (const field of ['key', 'mass', 'slot', 'ref', 'source']) {
      if (typeof entry[field] !== 'string') problems.push(`${at}: "${field}" must be a string`);
    }
    if (!ENTRY_KINDS.includes(entry['kind'] as EntryKind))
      problems.push(`${at}: "kind" must be one of ${ENTRY_KINDS.join(', ')}`);
    for (const field of ['cycle', 'canonical']) {
      if (entry[field] !== undefined && typeof entry[field] !== 'string')
        problems.push(`${at}: "${field}" must be a string`);
    }
    for (const field of ['alternatives', 'alternativesCanonical']) {
      if (entry[field] !== undefined && !isStringArray(entry[field]))
        problems.push(`${at}: "${field}" must be an array of strings`);
    }
    return undefined;
  });
  if (json['consulted'] !== undefined) {
    if (!Array.isArray(json['consulted'])) problems.push(`${label}: "consulted" must be an array`);
    else
      json['consulted'].forEach((item: unknown, i) => {
        const ok =
          isRecord(item) &&
          ENTRY_KINDS.includes(item['kind'] as EntryKind) &&
          typeof item['key'] === 'string' &&
          typeof item['source'] === 'string' &&
          (item['note'] === undefined || typeof item['note'] === 'string');
        if (!ok) problems.push(`${label} consulted[${i}]: expected { "kind", "key", "source", "note"? }`);
      });
  }
  return problems.length === 0 ? { data: json as unknown as CrosscheckFile, problems } : { problems };
}

/** The canonical key of a second-source ref, or the reason it has none. */
function theirKey(
  ref: string,
  canonical: string | undefined,
  convention: Convention,
): { key?: string; reason?: string } {
  if (canonical !== undefined) {
    const problems = checkRefString(canonical, 'canonical');
    if (problems.length > 0) return { reason: problems.join('; ') };
    return { key: toKey(parseRef(canonical)) };
  }
  const parsed = tryParseRef(ref);
  if (!parsed.ok) return { reason: `second-source ref "${ref}" does not parse: ${parsed.error.message}` };
  try {
    return { key: toKey(toCanonical(parsed.value, convention)) };
  } catch (error) {
    // toCanonical throws only ConversionError for a parsed ref.
    return { reason: `cannot convert "${ref}" from ${convention}: ${(error as ConversionError).message}` };
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.length === sb.length && sa.every((x, i) => x === sb[i]);
}

/**
 * Compares the block's readings with the cross-check entries. The block must pass
 * `lectionary:check` first (its refs are parsed without further checks). Every reading is either compared
 * (agreeing or not) or listed as single-source; every cross-check entry that matches no reading,
 * cites an invalid or non-independent source, or cannot be converted is a disagreement.
 */
export function crosscheckBlock(
  block: string,
  files: readonly LoadedFile[],
  crosscheck: CrosscheckFile,
  registry: SourceRegistry,
): CrosscheckResult {
  const rows = blockRows(files);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const disagreements: Disagreement[] = [];
  const compared = new Set<string>();
  let agreements = 0;

  for (const entry of crosscheck.entries) {
    const id = rowId(entry.kind, entry.key, entry.mass, entry.slot, entry.cycle);
    const row = byId.get(id);
    const fail = (reason: string): void => {
      disagreements.push({ id, ...(row === undefined ? {} : { ours: row.reading.ref }), theirs: entry.ref, reason });
    };
    if (row === undefined) {
      fail('the block has no such reading');
      continue;
    }
    compared.add(id);
    const sourceProblems = checkSource(entry.source, registry);
    if (sourceProblems.length > 0) {
      fail(sourceProblems.join('; '));
      continue;
    }
    const theirId = (splitSource(entry.source) as { id: string }).id;
    if (splitSource(row.reading.source)?.id === theirId) {
      fail(`not independent: both cite ${theirId}`);
      continue;
    }
    const convention = (registry.sources[theirId] as { convention: Convention }).convention;
    const main = theirKey(entry.ref, entry.canonical, convention);
    const alternatives = (entry.alternatives ?? []).map((alt, i) =>
      theirKey(alt, entry.alternativesCanonical?.[i], convention),
    );
    const reason = [main, ...alternatives].find((result) => result.reason !== undefined)?.reason;
    if (reason !== undefined) {
      fail(reason);
      continue;
    }
    const ours = refKey(row.reading.ref);
    if (main.key !== ours) {
      fail(`passage differs: ours ${ours}, theirs ${String(main.key)}`);
      continue;
    }
    const ourAlternatives = (row.reading.alternatives ?? []).map((alt) => refKey(alt.ref));
    const theirAlternatives = alternatives.map((alt) => String(alt.key));
    if (!sameSet(ourAlternatives, theirAlternatives)) {
      fail(`alternatives differ: ours [${ourAlternatives.join(', ')}], theirs [${theirAlternatives.join(', ')}]`);
      continue;
    }
    agreements += 1;
  }

  const singleSource = rows
    .filter((row) => !compared.has(row.id))
    .map((row) => ({
      id: row.id,
      ours: row.reading.ref,
      source: row.reading.source,
      consulted: (crosscheck.consulted ?? [])
        .filter((c) => c.kind === row.kind && c.key === row.key)
        .map((c) => (c.note === undefined ? c.source : `${c.source} (${c.note})`)),
    }));
  return { block, compared: compared.size, agreements, disagreements, singleSource };
}

/** The disputes file for the owner: deterministic Markdown (lists, so Prettier leaves it alone), no timestamps. */
export function renderDisputes(result: CrosscheckResult): string {
  const lines = [
    `# Lectionary disputes: block \`${result.block}\``,
    '',
    `Written by \`npm run lectionary:crosscheck -- --block ${result.block}\`. Do not edit by hand; fix the data or`,
    `\`calendar/lectionary/crosscheck/${result.block}.json\` and run it again.`,
    '',
    `- Readings compared with a second source: ${result.compared}`,
    `- Agreements: ${result.agreements}`,
    `- Disagreements: ${result.disagreements.length}`,
    `- Single-source readings: ${result.singleSource.length}`,
    '',
    '## Disagreements',
    '',
  ];
  if (result.disagreements.length === 0) lines.push('None.');
  for (const d of result.disagreements) {
    const ours = d.ours === undefined ? 'no reading' : `\`${d.ours}\``;
    lines.push(`- \`${d.id}\`: ours ${ours}, second source \`${String(d.theirs)}\`. ${d.reason}.`);
  }
  lines.push(
    '',
    '## Single-source readings',
    '',
    'No independent second source covers these readings yet. They stay `provisional` until a person checks them',
    'against the Kenyan _Lectionary_ (docs/decisions/011-lectionary-source.md).',
    '',
  );
  if (result.singleSource.length === 0) lines.push('None.');
  const groups = new Map<string, SingleSource[]>();
  for (const single of result.singleSource) {
    const entry = single.id.slice(0, single.id.indexOf(' '));
    groups.set(entry, [...(groups.get(entry) ?? []), single]);
  }
  for (const [entry, singles] of groups) {
    const readings = singles.map((s) => `${s.id.slice(entry.length + 1)} \`${s.ours}\``).join('; ');
    const unique = (items: string[]): string => [...new Set(items)].map((item) => `\`${item}\``).join(', ');
    const consulted = singles.flatMap((s) => s.consulted);
    const tail = consulted.length === 0 ? '' : ` Consulted without result: ${unique(consulted)}.`;
    lines.push(`- \`${entry}\`: ${readings}. Source: ${unique(singles.map((s) => s.source))}.${tail}`);
  }
  return `${lines.join('\n')}\n`;
}
