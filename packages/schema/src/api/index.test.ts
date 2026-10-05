import type { ValidateFunction } from 'ajv/dist/2020.js';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { loadFixture, loadFixtures } from '../../fixtures/load.ts';
import { schemaId, formatErrors } from '../common/index.ts';
import { passageSchema } from '../passage/index.ts';
import {
  API_ENDPOINTS,
  API_SCHEMAS,
  API_VERSION,
  UPCOMING_DAYS,
  validateApiCalendar,
  validateApiDay,
  validateApiIndex,
  validateApiPassage,
  validateApiPassageIndex,
  validateApiUpcoming,
} from './index.ts';
import type { ApiAudio, ApiDay, ApiDayReading, ApiNotes } from './index.ts';

/** Fixture names are `<document>` or `<document>--<case>`; the document picks the validator. */
const VALIDATORS: Record<string, ValidateFunction> = {
  index: validateApiIndex,
  day: validateApiDay,
  passage: validateApiPassage,
  'passage-index': validateApiPassageIndex,
  calendar: validateApiCalendar,
  upcoming: validateApiUpcoming,
};

function validatorFor(name: string): ValidateFunction {
  const validator = VALIDATORS[name.split('--')[0] as string];
  if (validator === undefined) throw new Error(`No validator for fixture ${name}`);
  return validator;
}

const MT = '/masses/0/readings/3';

const EXPECTED_FAILURES: Record<string, [instancePath: string, keyword: string]> = {
  'calendar--reading-without-has-notes': ['/days/0/masses/0/readings/0', 'required'],
  'day--audio-not-http': [`${MT}/passage/context/audio/url`, 'pattern'],
  'day--context-without-audio': [`${MT}/passage/context`, 'required'],
  'day--pending-review': [`${MT}/passage/review/status`, 'const'],
  'day--provenance-leak': [`${MT}/passage`, 'additionalProperties'],
  'day--reading-with-text': [MT, 'additionalProperties'],
  'day--unknown-colour': ['/colour', 'enum'],
  'day--wrong-api-version': ['/apiVersion', 'const'],
  'index--changed-endpoint': ['/endpoints/day', 'const'],
  'index--relative-api-root': ['/apiRoot', 'format'],
  'passage--duplicate-dates': ['/dates', 'uniqueItems'],
  'passage--passage-with-verses': ['/passage', 'additionalProperties'],
  'passage-index--bad-key': ['/passages/0/key', 'pattern'],
  'upcoming--too-many-days': ['/days', 'maxItems'],
};

describe('api fixtures', () => {
  const valid = loadFixtures('api', 'valid');
  const invalid = loadFixtures('api', 'invalid');

  it.each([...valid])('valid/%s passes', (name, data) => {
    const validate = validatorFor(name);
    const ok = validate(data);
    expect(formatErrors(ok ? [] : validate.errors)).toEqual([]);
    expect(ok).toBe(true);
  });

  it.each([...invalid])('invalid/%s fails for the expected reason', (name, data) => {
    const validate = validatorFor(name);
    expect(validate(data)).toBe(false);
    const errors = (validate.errors ?? []).map((error) => [error.instancePath, error.keyword]);
    expect(errors).toContainEqual(EXPECTED_FAILURES[name]);
  });

  it('has an expectation for every invalid fixture and a fixture for every expectation', () => {
    expect([...invalid.keys()].sort()).toEqual(Object.keys(EXPECTED_FAILURES).sort());
  });

  it('has a valid fixture for every document', () => {
    expect([...valid.keys()].filter((name) => !name.includes('--')).sort()).toEqual(Object.keys(VALIDATORS).sort());
  });

  it('rejects a fixture name without a validator', () => {
    expect(() => validatorFor('nope')).toThrow(/No validator for fixture nope/);
  });
});

describe('api schemas', () => {
  it('gives every schema its own $id under the api- prefix', () => {
    for (const [name, schema] of Object.entries(API_SCHEMAS)) {
      expect(name).toMatch(/^api-/);
      expect(schema.$id).toBe(schemaId(name));
    }
  });

  it('publishes v1 with a 14-day upcoming window and stable endpoint templates', () => {
    expect(API_VERSION).toBe(1);
    expect(UPCOMING_DAYS).toBe(14);
    expect(API_ENDPOINTS).toEqual({
      index: 'index.json',
      day: 'days/{date}.json',
      passages: 'passages/index.json',
      passage: 'passages/{key}.json',
      calendar: 'calendar/{year}.json',
      upcoming: 'upcoming.json',
    });
  });

  it('reuses the passage claim and source fragments unchanged', () => {
    const notes = API_SCHEMAS['api-passage'].properties.passage;
    expect(notes.properties.claims).toBe(passageSchema.properties.claims);
    expect(notes.properties.sources).toBe(passageSchema.properties.sources);
  });

  it('allows null or an http(s) URL for audio', () => {
    const day = loadFixture('api', 'valid', 'day') as ApiDay;
    const reading = day.masses[0]?.readings[3] as ApiDayReading;
    const notes = reading.passage as ApiNotes;
    expect(notes.context.audio).toBeNull();
    const audio = { ...notes, context: { ...notes.context, audio: { url: 'https://a.example/x.mp3' } } };
    const withAudio = { ...day, masses: [{ ...day.masses[0], readings: [{ ...reading, passage: audio }] }] };
    expect(validateApiDay(withAudio)).toBe(true);
    const negative = {
      ...audio,
      context: { ...audio.context, audio: { url: 'https://a.example/x.mp3', durationSeconds: -1 } },
    };
    expect(
      validateApiDay({ ...withAudio, masses: [{ ...day.masses[0], readings: [{ ...reading, passage: negative }] }] }),
    ).toBe(false);
  });

  it('derives types from the schemas', () => {
    expectTypeOf<ApiDay['apiVersion']>().toEqualTypeOf<1>();
    expectTypeOf<ApiAudio>().toEqualTypeOf<{ url: string; durationSeconds?: number } | null>();
    expectTypeOf<ApiNotes['review']['status']>().toEqualTypeOf<'approved'>();
  });
});
