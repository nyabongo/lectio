/**
 * The `source` field (`<source-id>[@<revision>] <locator>`) and the source registry
 * (`calendar/lectionary/sources.json`), per docs/decisions/011-lectionary-source.md.
 */
import { CONVENTIONS } from './types.ts';
import type { SourceInfo, SourceRegistry } from './types.ts';

/** The full-line grammar of `source` (011). */
export const SOURCE_LINE = /^(?<id>[a-z0-9-]+)(?:@(?<rev>[0-9a-f]{40}))? (?<locator>\S+)$/;

export interface ParsedSource {
  readonly id: string;
  readonly revision?: string;
  readonly locator: string;
}

/** Splits a `source` string, or returns undefined when it does not match {@link SOURCE_LINE}. */
export function splitSource(source: string): ParsedSource | undefined {
  const groups = SOURCE_LINE.exec(source)?.groups;
  if (groups === undefined) return undefined;
  const { id, rev, locator } = groups as { id: string; rev?: string; locator: string };
  return rev === undefined ? { id, locator } : { id, revision: rev, locator };
}

/** The anchored locator expression of a registry entry. */
export function locatorRegExp(info: Pick<SourceInfo, 'locatorPattern'>): RegExp {
  return new RegExp(`^(?:${info.locatorPattern})$`);
}

/**
 * Checks a `source` against the line grammar and the registry: the id exists, the revision is
 * present (and equals the pinned one) for versioned sources and absent for print sources, and the
 * locator matches the id's grammar. Returns the problems, empty when the source is valid.
 */
export function checkSource(source: string, registry: SourceRegistry): string[] {
  const parsed = splitSource(source);
  if (parsed === undefined) return [`source "${source}" does not match <source-id>[@<40-hex revision>] <locator>`];
  const info = registry.sources[parsed.id];
  if (info === undefined) return [`source id "${parsed.id}" is not in sources.json`];
  const problems: string[] = [];
  if (info.revision === 'required') {
    if (parsed.revision === undefined) problems.push(`source "${source}": ${parsed.id} citations need @<revision>`);
    else if (info.pinned !== undefined && parsed.revision !== info.pinned) {
      problems.push(`source "${source}": revision is not the pinned ${parsed.id} revision ${info.pinned}`);
    }
  } else if (parsed.revision !== undefined) {
    problems.push(`source "${source}": ${parsed.id} is a print source and takes no @<revision>`);
  }
  if (!locatorRegExp(info).test(parsed.locator)) {
    problems.push(
      `source "${source}": locator "${parsed.locator}" does not match ${parsed.id}'s /${info.locatorPattern}/`,
    );
  }
  return problems;
}

const STRING_FIELDS = [
  'title',
  'bibliography',
  'translation',
  'versification',
  'psalmNumbering',
  'licence',
  'permission',
  'locatorPattern',
  'locatorExample',
] as const;
const PERMISSION = /^(none-needed|to-request|requested \d{4}-\d{2}-\d{2}|granted \d{4}-\d{2}-\d{2} \S.*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkInfo(id: string, info: Record<string, unknown>): string[] {
  const where = `sources.json: ${id}`;
  const problems: string[] = [];
  for (const field of STRING_FIELDS) {
    if (typeof info[field] !== 'string' || info[field] === '')
      problems.push(`${where}: ${field} must be a non-empty string`);
  }
  if (!CONVENTIONS.includes(info['convention'] as never)) {
    problems.push(`${where}: convention must be one of ${CONVENTIONS.join(', ')}`);
  }
  if (typeof info['automatedRetrieval'] !== 'boolean') problems.push(`${where}: automatedRetrieval must be a boolean`);
  if (info['physicalCopy'] !== null && typeof info['physicalCopy'] !== 'string') {
    problems.push(`${where}: physicalCopy must be a string or null`);
  }
  if (typeof info['permission'] === 'string' && !PERMISSION.test(info['permission'])) {
    problems.push(`${where}: permission must be none-needed, to-request, requested <date> or granted <date> <ref>`);
  }
  if (info['revision'] !== 'required' && info['revision'] !== 'forbidden') {
    problems.push(`${where}: revision must be "required" or "forbidden"`);
  }
  if (info['pinned'] !== undefined && !/^[0-9a-f]{40}$/.test(String(info['pinned']))) {
    problems.push(`${where}: pinned must be a 40-character lower-case git SHA`);
  }
  if (typeof info['locatorPattern'] === 'string') {
    try {
      const pattern = locatorRegExp({ locatorPattern: info['locatorPattern'] });
      if (typeof info['locatorExample'] === 'string' && !pattern.test(info['locatorExample'])) {
        problems.push(`${where}: locatorExample does not match locatorPattern`);
      }
    } catch {
      problems.push(`${where}: locatorPattern is not a valid regular expression`);
    }
  }
  return problems;
}

/** Validates a parsed `sources.json`; returns the registry, or the problems found. */
export function parseRegistry(json: unknown): { registry: SourceRegistry; problems: string[] } {
  if (!isRecord(json) || !isRecord(json['sources'])) {
    return { registry: { sources: {} }, problems: ['sources.json: expected { "sources": { <id>: {...} } }'] };
  }
  const problems: string[] = [];
  const sources: Record<string, SourceInfo> = {};
  for (const [id, info] of Object.entries(json['sources'])) {
    if (!/^[a-z0-9-]+$/.test(id)) problems.push(`sources.json: id "${id}" must match [a-z0-9-]+`);
    if (!isRecord(info)) {
      problems.push(`sources.json: ${id} must be an object`);
      continue;
    }
    const found = checkInfo(id, info);
    problems.push(...found);
    if (found.length === 0) sources[id] = info as unknown as SourceInfo;
  }
  return { registry: { sources }, problems };
}
