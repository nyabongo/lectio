import { describe, expect, it } from 'vitest';

import { claim, verdict } from './fixtures/facts.ts';
import { readVerifierClaims } from './verifiers.ts';

describe('readVerifierClaims', () => {
  it('reads per-claim records; a missing verifier verdict reads as null', () => {
    const records = [claim('c1'), { ...claim('c2'), confirmer: undefined, refuter: null }];
    expect(readVerifierClaims({ claims: records })).toEqual({
      ok: true,
      claims: [claim('c1'), { ...claim('c2'), confirmer: null, refuter: null }],
    });
    expect(readVerifierClaims({ claims: [] })).toEqual({ ok: true, claims: [] });
  });

  it('needs a meta.claims list', () => {
    expect(readVerifierClaims({})).toEqual({ ok: false, error: 'the verifiers result has no meta.claims list' });
    expect(readVerifierClaims({ claims: {} })).toMatchObject({ ok: false });
  });

  it.each([
    ['not an object', 'c1'],
    ['an array', []],
    ['no file', { ...claim('c1'), file: '' }],
    ['a numeric file', { ...claim('c1'), file: 3 }],
    ['no claim id', { ...claim('c1'), claimId: '' }],
    ['a numeric claim id', { ...claim('c1'), claimId: 1 }],
    ['no generator flag', { ...claim('c1'), sensitive: undefined }],
    ['a verdict that is not an object', { ...claim('c1'), confirmer: 'supported' }],
    ['an unknown verdict', { ...claim('c1'), refuter: { ...verdict(), verdict: 'maybe' } }],
    ['a numeric verdict', { ...claim('c1'), refuter: { ...verdict(), verdict: 1 } }],
    ['a support above 1', { ...claim('c1'), confirmer: verdict({ support: 1.2 }) }],
    ['a negative support', { ...claim('c1'), confirmer: verdict({ support: -0.1 }) }],
    ['a NaN support', { ...claim('c1'), confirmer: verdict({ support: Number.NaN }) }],
    ['a string support', { ...claim('c1'), confirmer: { ...verdict(), support: '0.9' } }],
    ['no verifier sensitive flag', { ...claim('c1'), refuter: { verdict: 'supported', support: 1 } }],
  ])('rejects a record with %s', (_name, record) => {
    expect(readVerifierClaims({ claims: [claim('c0'), record] })).toEqual({
      ok: false,
      error: 'meta.claims/1 is not a readable claim record',
    });
  });
});
