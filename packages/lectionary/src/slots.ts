/**
 * The order readings are proclaimed in. The schema's `READING_SLOTS` lists the slots, not their order
 * in a Mass: the Easter Vigil reads `reading-1`, `psalm-1`, `reading-2`, `psalm-2`, …, `epistle`,
 * the psalm after the epistle (`psalm-8` in the data, the one numbered psalm without a reading of
 * its number), and the gospel last.
 */
import type { ReadingSlot } from '@lectio/schema/common';

const NAMED: Readonly<Record<string, number>> = {
  'first-reading': 0,
  psalm: 1,
  'second-reading': 2,
  epistle: 100,
  gospel: 200,
};

/**
 * A rank for each slot of one Mass (`slots` are all the slots it has): lower is read first.
 * `reading-n` and `psalm-n` alternate by number; a `psalm-n` without a `reading-n` follows the epistle.
 */
export function slotRanker(slots: Iterable<ReadingSlot>): (slot: ReadingSlot) => number {
  const present = new Set<string>(slots);
  return (slot) => {
    const named = NAMED[slot];
    if (named !== undefined) return named;
    const [, kind, n] = /^(reading|psalm)-(\d)$/.exec(slot) as RegExpExecArray;
    const number = Number(n);
    if (kind === 'reading') return 10 + 2 * number;
    return present.has(`reading-${String(number)}`) ? 11 + 2 * number : 101 + number;
  };
}

/** The readings in proclamation order (stable for equal slots). */
export function sortBySlot<T extends { readonly slot: ReadingSlot }>(readings: readonly T[]): T[] {
  const rank = slotRanker(readings.map((reading) => reading.slot));
  return [...readings].sort((a, b) => rank(a.slot) - rank(b.slot));
}
