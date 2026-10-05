import type { ReadingSlot } from '@lectio/schema/common';
import { describe, expect, it } from 'vitest';

import { slotRanker, sortBySlot } from './slots.ts';

const order = (slots: ReadingSlot[]) => sortBySlot(slots.map((slot) => ({ slot }))).map((r) => r.slot);

describe('slot order', () => {
  it('orders a Sunday Mass', () => {
    expect(order(['gospel', 'second-reading', 'psalm', 'first-reading'])).toEqual([
      'first-reading',
      'psalm',
      'second-reading',
      'gospel',
    ]);
  });

  it('orders the Easter Vigil: each reading and its psalm, the epistle, its psalm, the gospel', () => {
    expect(
      order(['gospel', 'reading-1', 'reading-2', 'reading-7', 'psalm-1', 'psalm-2', 'psalm-7', 'psalm-8', 'epistle']),
    ).toEqual(['reading-1', 'psalm-1', 'reading-2', 'psalm-2', 'reading-7', 'psalm-7', 'epistle', 'psalm-8', 'gospel']);
  });

  it('ranks a numbered psalm by whether its reading is there', () => {
    const rank = slotRanker(['reading-1', 'psalm-1', 'psalm-2']);
    expect(rank('psalm-1')).toBeLessThan(rank('epistle'));
    expect(rank('psalm-2')).toBeGreaterThan(rank('epistle'));
    expect(rank('psalm-2')).toBeLessThan(rank('gospel'));
  });
});
