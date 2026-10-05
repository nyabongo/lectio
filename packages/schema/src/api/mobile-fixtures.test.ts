/**
 * Contract test for the Flutter app (L-101): every JSON fixture in `apps/mobile/test/fixtures/` must be a valid API
 * v1 document, so the Dart models are tested against the same schemas the site's output is. A fixture's file name
 * picks its schema: `<document>.json` or `<document>-<case>.json`, where `<document>` is `index`, `day`, `passage`,
 * `passage-index`, `calendar` or `upcoming`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ValidateFunction } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { formatErrors } from '../common/index.ts';
import {
  validateApiCalendar,
  validateApiDay,
  validateApiIndex,
  validateApiPassage,
  validateApiPassageIndex,
  validateApiUpcoming,
} from './index.ts';

const MOBILE_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../../apps/mobile/test/fixtures');

/** Longest document names first, so `passage-index` wins over `passage`. */
const VALIDATORS: [document: string, validate: ValidateFunction][] = [
  ['passage-index', validateApiPassageIndex],
  ['calendar', validateApiCalendar],
  ['upcoming', validateApiUpcoming],
  ['passage', validateApiPassage],
  ['index', validateApiIndex],
  ['day', validateApiDay],
];

/** The document a fixture stem names, or `undefined`. */
function documentOf(stem: string): string | undefined {
  return VALIDATORS.find(([document]) => stem === document || stem.startsWith(`${document}-`))?.[0];
}

const fixtures = readdirSync(MOBILE_FIXTURES)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => {
    const stem = file.slice(0, -'.json'.length);
    return { stem, data: JSON.parse(readFileSync(join(MOBILE_FIXTURES, file), 'utf8')) as unknown };
  });

describe('apps/mobile/test/fixtures', () => {
  it('has a fixture for every API document', () => {
    const covered = new Set(fixtures.map(({ stem }) => documentOf(stem)));
    expect([...covered].sort()).toEqual(VALIDATORS.map(([document]) => document).sort());
  });

  it('names every fixture after a document', () => {
    expect(fixtures.filter(({ stem }) => documentOf(stem) === undefined).map(({ stem }) => stem)).toEqual([]);
  });

  it.each(fixtures.map(({ stem, data }) => [stem, data] as const))('%s is a valid API v1 document', (stem, data) => {
    const validate = VALIDATORS.find(([document]) => document === documentOf(stem))?.[1];
    expect(validate).toBeDefined();
    const valid = validate?.(data);
    expect(valid, formatErrors(validate?.errors).join('; ')).toBe(true);
  });

  it('covers durationSeconds both known and null (always present since L-082)', () => {
    const audio = fixtures.flatMap(({ data }) => JSON.stringify(data).match(/"audio":\{[^}]*\}/g) ?? []);
    expect(audio.length).toBeGreaterThan(0);
    expect(audio.every((entry) => entry.includes('"durationSeconds":'))).toBe(true);
    expect(audio.some((entry) => entry.includes('"durationSeconds":null'))).toBe(true);
    expect(audio.some((entry) => /"durationSeconds":\d/.test(entry))).toBe(true);
  });
});

describe('documentOf', () => {
  it('reads the document from the stem', () => {
    expect(documentOf('passage-index')).toBe('passage-index');
    expect(documentOf('passage')).toBe('passage');
    expect(documentOf('index-empty')).toBe('index');
    expect(documentOf('day-with-audio')).toBe('day');
    expect(documentOf('daylight')).toBeUndefined();
  });
});
