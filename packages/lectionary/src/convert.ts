/**
 * Conversion of a reference from a source's numbering convention to canonical (NABRE ≈ original,
 * ADR 0004), for `lectionary:crosscheck`. 011 lists the cases:
 *
 * - `vulgate` (OLM 1981, Nova Vulgata, LXX): psalm numbers. Joel and Malachi already follow the
 *   Hebrew chapters there.
 * - `rsv` (RSV-2CE): Joel 2:28–3:21 = 3:1–4:21, Malachi 4:1-6 = 3:19-24.
 * - Esther, Sirach and Tobit differ entry by entry between traditions; a reference to them from a
 *   non-NABRE source is not converted automatically ({@link ConversionError}), and the cross-check
 *   entry must carry a hand-made `canonical` ref instead.
 * - RSV psalm verse numbers (superscriptions not counted) need L-006's tables; until then an RSV
 *   psalm is reported the same way.
 *
 * Verse letters are dropped first; they never matter for the comparison.
 */
import type { Point, Ref, Segment } from '@lectio/refs';

import { stripLetters } from './canonical.ts';
import type { Convention } from './types.ts';

export class ConversionError extends Error {
  override readonly name = 'ConversionError';
}

/** Hebrew psalm and verse offset for a Vulgate psalm and verse. */
function vulgatePsalm(c: number, v: number | undefined): { c: number; offset: number } {
  if (c <= 8 || c >= 148) return { c, offset: 0 };
  if (c === 9) return v !== undefined && v >= 22 ? { c: 10, offset: -21 } : { c: 9, offset: 0 };
  if (c <= 112) return { c: c + 1, offset: 0 };
  if (c === 113) return v !== undefined && v >= 9 ? { c: 115, offset: -8 } : { c: 114, offset: 0 };
  if (c === 114) return { c: 116, offset: 0 };
  if (c === 115) return { c: 116, offset: 9 };
  if (c <= 145) return { c: c + 1, offset: 0 };
  if (c === 146) return { c: 147, offset: 0 };
  return { c: 147, offset: 11 };
}

/** Whole Vulgate psalms that are part of, or span, Hebrew psalms. */
const WHOLE_VULGATE: Readonly<Record<number, Segment>> = {
  9: { start: { c: 9 }, end: { c: 10 } },
  113: { start: { c: 114 }, end: { c: 115 } },
  114: { start: { c: 116, v: 1 }, end: { c: 116, v: 9 } },
  115: { start: { c: 116, v: 10 }, end: { c: 116, v: 19 } },
  146: { start: { c: 147, v: 1 }, end: { c: 147, v: 11 } },
  147: { start: { c: 147, v: 12 }, end: { c: 147, v: 20 } },
};

function vulgatePoint({ c, v }: Point): Point {
  const mapped = vulgatePsalm(c, v);
  return v === undefined ? { c: mapped.c } : { c: mapped.c, v: v + mapped.offset };
}

function vulgateSegment(segment: Segment): Segment {
  const { start, end } = segment;
  if (start.v === undefined) {
    if (start.c === end.c && WHOLE_VULGATE[start.c] !== undefined) return WHOLE_VULGATE[start.c] as Segment;
    return { start: vulgatePoint(start), end: vulgatePoint(end) };
  }
  const from = vulgatePoint(start);
  const to = vulgatePoint(end);
  if (from.c !== to.c && start.c === end.c) {
    throw new ConversionError(`Vulgate Ps ${start.c}:${start.v}-${end.v} spans two Hebrew psalms; split it`);
  }
  return { start: from, end: to };
}

/** RSV → NABRE chapter shifts: [book, RSV chapter, first RSV verse, last RSV verse, NABRE chapter, verse offset]. */
const RSV_SHIFTS: readonly (readonly [string, number, number, number, number, number])[] = [
  ['JL', 2, 28, 32, 3, -27],
  ['JL', 3, 1, 21, 4, 0],
  ['MAL', 4, 1, 6, 3, 18],
];

function rsvPoint(book: string, { c, v }: Point): Point {
  for (const [code, chapter, first, last, target, offset] of RSV_SHIFTS) {
    if (code !== book || c !== chapter) continue;
    if (v === undefined) {
      if (offset === 0) return { c: target };
      throw new ConversionError(`RSV ${book} ${c} as a whole chapter has no single NABRE chapter`);
    }
    if (v >= first && v <= last) return { c: target, v: v + offset };
  }
  return v === undefined ? { c } : { c, v };
}

const ENTRY_BY_ENTRY = new Set(['EST', 'SIR', 'TB']);

/**
 * Converts `ref` from `convention` to canonical, letters dropped. Throws a {@link ConversionError}
 * when the reference cannot be converted automatically.
 */
export function toCanonical(ref: Ref, convention: Convention): Ref {
  const plain = stripLetters(ref);
  if (convention === 'nabre') return plain;
  if (ENTRY_BY_ENTRY.has(plain.book)) {
    throw new ConversionError(`${plain.book} numbering differs entry by entry; give the canonical ref by hand`);
  }
  if (convention === 'vulgate') {
    return plain.book === 'PS' ? { book: 'PS', segments: plain.segments.map(vulgateSegment) } : plain;
  }
  if (plain.book === 'PS')
    throw new ConversionError('RSV psalm verse numbers need the L-006 tables; give the canonical ref by hand');
  return {
    book: plain.book,
    segments: plain.segments.map(({ start, end }) => ({
      start: rsvPoint(plain.book, start),
      end: rsvPoint(plain.book, end),
    })),
  };
}
