/**
 * Conversion of a reference from a source's numbering convention to canonical (NABRE ≈ original,
 * ADR 0004), for `lectionary:crosscheck`. The tables are `@lectio/refs` versification (L-006);
 * this module only decides how a convention uses them (011, "Versification and conversion"):
 *
 * - `nabre`: already canonical.
 * - `vulgate` (OLM 1981, Nova Vulgata): Vulgate psalm numbers; see {@link novaVulgataPsalms}.
 *   Every other book follows the Hebrew chapters (Joel 3:1-5, Malachi 3:19-24), so it is read as
 *   canonical. The refs `vulgate` scheme's Joel and Malachi are the Clementine ones and are not used.
 * - `rsv` (RSV-2CE): the refs `english` scheme, for every book: psalm titles not counted
 *   (RSV Ps 51:1-2 = Ps 51:3-4), Joel 2:28–3:21 = 3:1–4:21, Malachi 4:1-6 = 3:19-24.
 * - Esther, Sirach and Tobit differ entry by entry between traditions; a reference to them from a
 *   non-NABRE source is not converted automatically ({@link ConversionError}), and the cross-check
 *   entry must carry a hand-made `canonical` ref instead.
 *
 * Verse letters are dropped first; they never matter for the comparison.
 */
import { chapterLength, mapRef } from '@lectio/refs';
import type { Ref, Segment, VersificationError } from '@lectio/refs';

import { stripLetters } from './canonical.ts';
import type { Convention } from './types.ts';

export class ConversionError extends Error {
  override readonly name = 'ConversionError';
}

const ENTRY_BY_ENTRY = new Set(['EST', 'SIR', 'TB']);

const wholePsalm = (c: number): Ref => ({ book: 'PS', segments: [{ start: { c }, end: { c } }] });

/** The one chapter a reference covers, or `undefined` if it covers several. */
function onlyChapter(ref: Ref): number | undefined {
  const chapters = new Set(ref.segments.flatMap(({ start, end }) => [start.c, end.c]));
  return chapters.size === 1 ? (chapters.values().next().value as number) : undefined;
}

const simplePsalms = new Map<number, number | undefined>();

/**
 * The Hebrew psalm that Vulgate psalm `c` is, verse for verse, or `undefined` when one of the two is
 * split between psalms (Vulgate 9 and 113 hold two Hebrew psalms; Hebrew 116 and 147 are two
 * Vulgate psalms each).
 */
function simplePsalm(c: number): number | undefined {
  if (!simplePsalms.has(c)) {
    const hebrew = onlyChapter(mapRef(wholePsalm(c), 'vulgate', 'original'));
    const back = hebrew === undefined ? undefined : onlyChapter(mapRef(wholePsalm(hebrew), 'original', 'vulgate'));
    simplePsalms.set(c, back === c ? hebrew : undefined);
  }
  return simplePsalms.get(c);
}

/**
 * Nova Vulgata psalm numbers → Hebrew. The psalm numbers come from the refs `vulgate` scheme (the
 * Stuttgart Vulgate). Its verse numbers are not the Nova Vulgata's everywhere: the Stuttgart text
 * counts some titles and verses its own way (its Ps 145:2 is Hebrew 146:1, and its Ps 15 has no
 * verse 11), whereas the Nova Vulgata numbers verses as the Hebrew does. So a psalm that is one
 * Hebrew psalm only changes number, and only the split psalms (Vulgate 9, 113, 114, 115, 146, 147)
 * are mapped verse by verse, where the two numberings agree. A verse past the end of a renumbered
 * psalm (NV `Ps 22:40`) is refused with a {@link ConversionError}.
 */
function novaVulgataPsalms(ref: Ref): Ref {
  const segments = ref.segments.flatMap((segment): Segment[] => {
    const { start, end } = segment;
    const first = simplePsalm(start.c);
    const last = simplePsalm(end.c);
    const simple = first !== undefined && last !== undefined && last - first === end.c - start.c;
    if (!simple) return [...mapRef({ book: 'PS', segments: [segment] }, 'vulgate', 'original').segments];
    for (const [point, hebrew] of [
      [start, first],
      [end, last],
    ] as const) {
      const verses = chapterLength('PS', hebrew) as number;
      if (point.v !== undefined && point.v > verses) {
        throw new ConversionError(
          `Ps ${String(point.c)}:${String(point.v)} does not exist (Nova Vulgata Ps ${String(point.c)} = Ps ${String(hebrew)}, ${String(verses)} verses)`,
        );
      }
    }
    return [{ start: { ...start, c: first }, end: { ...end, c: last } }];
  });
  return { book: 'PS', segments };
}

/**
 * Converts `ref` from `convention` to canonical, letters dropped. Throws a {@link ConversionError}
 * when the reference cannot be converted automatically, or names a verse the convention does not have.
 */
export function toCanonical(ref: Ref, convention: Convention): Ref {
  const plain = stripLetters(ref);
  if (convention === 'nabre') return plain;
  if (ENTRY_BY_ENTRY.has(plain.book)) {
    throw new ConversionError(`${plain.book} numbering differs entry by entry; give the canonical ref by hand`);
  }
  if (convention === 'vulgate' && plain.book !== 'PS') return plain;
  try {
    return convention === 'vulgate' ? novaVulgataPsalms(plain) : mapRef(plain, 'english', 'original');
  } catch (error) {
    // stripLetters keeps a valid ref valid, so mapRef can only fail on versification.
    if (error instanceof ConversionError) throw error;
    throw new ConversionError((error as VersificationError).message);
  }
}
