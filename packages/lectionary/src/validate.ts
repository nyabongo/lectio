/**
 * Shape validation of a lectionary data file. Reports every problem with a JSON-pointer-like
 * path; the semantic rules (refs, sources, cycles) are in check.ts.
 */
import { READING_SLOTS } from '@lectio/schema/common';

import { CYCLES, ENTRY_KINDS, STATUSES } from './types.ts';
import type { BlockFile } from './types.ts';

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && /^\S(.*\S)?$/s.test(value);
}

class Collector {
  readonly problems: string[] = [];
  private readonly file: string;
  constructor(file: string) {
    this.file = file;
  }
  add(path: string, message: string): void {
    this.problems.push(`${this.file}${path}: ${message}`);
  }
  /** Reports keys outside `allowed`. */
  only(value: Json, allowed: readonly string[], path: string): void {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) this.add(path, `unknown property "${key}"`);
  }
  text(value: Json, key: string, path: string, required: boolean): void {
    if (value[key] === undefined) {
      if (required) this.add(path, `"${key}" is required`);
    } else if (!isText(value[key])) {
      this.add(`${path}/${key}`, 'must be a non-empty string without surrounding spaces');
    }
  }
  oneOf(value: Json, key: string, allowed: readonly string[], path: string, required: boolean): void {
    if (value[key] === undefined) {
      if (required) this.add(path, `"${key}" is required`);
    } else if (!allowed.includes(value[key] as string)) {
      this.add(`${path}/${key}`, `must be one of ${allowed.join(', ')}`);
    }
  }
  array(value: Json, key: string, path: string): unknown[] | undefined {
    const items = value[key];
    if (items === undefined) {
      this.add(path, `"${key}" is required`);
      return undefined;
    }
    if (!Array.isArray(items)) {
      this.add(`${path}/${key}`, 'must be an array');
      return undefined;
    }
    return items;
  }
}

function checkAlternative(c: Collector, alternative: unknown, path: string): void {
  if (!isRecord(alternative)) return c.add(path, 'must be an object');
  c.only(alternative, ['ref', 'printed'], path);
  c.text(alternative, 'ref', path, true);
  c.text(alternative, 'printed', path, false);
}

function checkReading(c: Collector, reading: unknown, path: string): void {
  if (!isRecord(reading)) return c.add(path, 'must be an object');
  c.only(reading, ['slot', 'cycle', 'ref', 'printed', 'alternatives', 'source', 'status'], path);
  c.oneOf(reading, 'slot', READING_SLOTS, path, true);
  c.oneOf(reading, 'cycle', CYCLES, path, false);
  c.text(reading, 'ref', path, true);
  c.text(reading, 'printed', path, false);
  c.text(reading, 'source', path, true);
  c.oneOf(reading, 'status', STATUSES, path, true);
  if (reading['alternatives'] !== undefined) {
    c.array(reading, 'alternatives', path)?.forEach((alt, i) => checkAlternative(c, alt, `${path}/alternatives/${i}`));
  }
}

function checkMass(c: Collector, mass: unknown, path: string): void {
  if (!isRecord(mass)) return c.add(path, 'must be an object');
  c.only(mass, ['id', 'label', 'readings'], path);
  c.text(mass, 'id', path, true);
  c.text(mass, 'label', path, false);
  c.array(mass, 'readings', path)?.forEach((reading, i) => checkReading(c, reading, `${path}/readings/${i}`));
}

function checkEntry(c: Collector, entry: unknown, path: string): void {
  if (!isRecord(entry)) return c.add(path, 'must be an object');
  c.only(entry, ['key', 'common', 'masses'], path);
  c.text(entry, 'key', path, true);
  c.text(entry, 'common', path, false);
  c.array(entry, 'masses', path)?.forEach((mass, i) => checkMass(c, mass, `${path}/masses/${i}`));
}

/**
 * Checks the shape of a parsed data file. `file` prefixes every message. Returns the typed
 * file when there are no problems.
 */
export function validateBlockFile(json: unknown, file: string): { data?: BlockFile; problems: string[] } {
  const c = new Collector(file);
  if (!isRecord(json)) {
    c.add('', 'expected an object { "kind", "entries" }');
    return { problems: c.problems };
  }
  c.only(json, ['$comment', 'kind', 'entries'], '');
  c.oneOf(json, 'kind', ENTRY_KINDS, '', true);
  c.array(json, 'entries', '')?.forEach((entry, i) => checkEntry(c, entry, `/entries/${i}`));
  return c.problems.length === 0 ? { data: json as unknown as BlockFile, problems: [] } : { problems: c.problems };
}
