import { describe, expect, it } from 'vitest';

import { formatErrors } from '@lectio/schema/common';
import { calendarYearSchema, validateCalendarYear } from '@lectio/schema/calendar';
import { gateResultSchema, validateGateResult } from '@lectio/schema/gate-result';
import { passageSchema, validatePassage } from '@lectio/schema/passage';

import { generateFromSchema, validateAgainstSchema } from './json-schema.ts';

// The fake LLM's default output must pass the project's real content schemas (ajv),
// not only this package's validator.
describe('generateFromSchema against the @lectio/schema content schemas', () => {
  const cases = [
    ['passage', passageSchema, validatePassage],
    ['calendar year', calendarYearSchema, validateCalendarYear],
    ['gate result', gateResultSchema, validateGateResult],
  ] as const;

  for (const [name, schema, validate] of cases) {
    it(`generates a valid ${name} for several seeds`, () => {
      for (const seed of ['', 'a', 'b', 'mt-20']) {
        const value = generateFromSchema(schema, seed);
        expect(validateAgainstSchema(schema, value)).toEqual([]);
        expect(formatErrors(validate(value) ? [] : validate.errors)).toEqual([]);
      }
    });
  }
});
