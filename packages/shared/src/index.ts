/**
 * @lectio/shared: small helpers every package may use.
 *
 * Repo tooling lives in subpath exports so packages do not pull it in:
 * `@lectio/shared/coverage-floor`, `/coverage-summary`, `/planned-script`,
 * `/required-checks` and `/test-server` (the msw server for offline tests).
 */
export const packageName = '@lectio/shared';

export { assertNever } from './assert-never.ts';
export { addDays, dateRange, isIsoDate, toIsoDateInZone } from './dates.ts';
export type { IsoDate } from './dates.ts';
export { err, isErr, isOk, mapResult, ok, unwrap } from './result.ts';
export type { Err, Ok, Result } from './result.ts';
