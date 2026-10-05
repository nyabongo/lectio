/**
 * Gate 3, licence guard (L-026), over the real repository content: one named test per rule.
 *
 * Every rule must hold for every committed passage. `licence/commentary-unchecked` is a
 * needs-review flag: this suite runs offline with the fake fetcher, which knows no page, so each
 * cited web source is flagged rather than checked. Flags are allowed here; errors are not.
 */
import { describe, expect, it } from 'vitest';

import { GATES } from '@lectio/gates';
import type { Gate } from '@lectio/gates';
import { LIMITATION } from '@lectio/textguard';

import { gateResult, gateTest } from './helpers/gate-test.ts';

const licenceGate = GATES.find((gate) => gate.id === 'licence') as Gate;

describe('gate 3: licence guard', () => {
  gateTest('licence/quoted-english-run');
  gateTest('licence/pd-bible-overlap');
  gateTest('licence/commentary-overlap');
  gateTest('licence/commentary-unchecked', { allow: ['warning', 'info'] });
  gateTest('licence/excerpt-length');
  gateTest('licence/guard-index');

  it('repeats the shingle-index limitation in its output', async () => {
    const result = await gateResult(licenceGate);
    expect(result.meta['limitation']).toBe(LIMITATION);
    expect(result.items.some((item) => item.severity === 'info' && item.message.includes(LIMITATION))).toBe(true);
  });
});
