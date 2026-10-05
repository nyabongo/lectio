import type { Book } from './books.ts';
import type { Point, Ref, Segment } from './types.ts';
import { checkRef } from './validate.ts';

/**
 * - `short`: lectionary abbreviation, `Mt 20:1–16a`, `Phil 1:20c–24, 27a`
 * - `long`: English name, `Matthew 20:1–16a`, `Psalm 145:2–3, 8–9`
 * - `spoken`: for narration, `Matthew chapter 20, verses 1 to 16` (sub-verse letters dropped)
 */
export type RefStyle = 'short' | 'long' | 'spoken';

export interface FormatOptions {
  readonly style?: RefStyle;
}

const DASH = '–';

function samePoint(a: Point, b: Point): boolean {
  return a.c === b.c && a.v === b.v && a.part === b.part;
}

/** Whether a segment must name its chapter: always, unless it continues the previous segment's chapter. */
function showsChapter(book: Book, segment: Segment, previous: Segment | undefined): boolean {
  if (book.singleChapter) return false;
  if (segment.start.v === undefined) return true;
  return previous?.end.v === undefined || previous.end.c !== segment.start.c;
}

function verseText(point: Point, withChapter: boolean): string {
  return `${withChapter ? `${point.c}:` : ''}${point.v}${point.part ?? ''}`;
}

function writtenSegment({ start, end }: Segment, withChapter: boolean): string {
  if (start.v === undefined) return start.c === end.c ? `${start.c}` : `${start.c}${DASH}${end.c}`;
  const head = verseText(start, withChapter);
  return samePoint(start, end) ? head : `${head}${DASH}${verseText(end, end.c !== start.c)}`;
}

function written(book: Book, name: string, segments: readonly Segment[]): string {
  let text = '';
  segments.forEach((segment, i) => {
    const withChapter = showsChapter(book, segment, segments[i - 1]);
    const separator = i === 0 ? '' : withChapter ? '; ' : ', ';
    text += separator + writtenSegment(segment, withChapter);
  });
  return `${name} ${text}`;
}

function list(items: readonly string[]): string {
  return items.length === 1 ? `${items[0]}` : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function spoken(book: Book, segments: readonly Segment[]): string {
  const psalm = book.code === 'PS';
  const chapter = (c: number): string => (psalm ? `Psalm ${c}` : `chapter ${c}`);
  const groups: { header: string; items: string[]; plural: boolean }[] = [];
  segments.forEach((segment, i) => {
    const { start, end } = segment;
    if (start.v === undefined) {
      const header = start.c === end.c ? chapter(start.c) : `${psalm ? 'Psalms' : 'chapters'} ${start.c} to ${end.c}`;
      groups.push({ header, items: [], plural: false });
      return;
    }
    const current = groups.at(-1);
    const group =
      current && !showsChapter(book, segment, segments[i - 1])
        ? current
        : { header: book.singleChapter ? '' : chapter(start.c), items: [], plural: false };
    if (group !== current) groups.push(group);
    if (start.c !== end.c) group.items.push(`${start.v} to ${chapter(end.c)}, verse ${end.v}`);
    else if (start.v === end.v) group.items.push(`${start.v}`);
    else {
      group.items.push(`${start.v} to ${end.v}`);
      group.plural = true;
    }
    if (group.items.length > 1) group.plural = true;
  });
  const text = groups
    .map(({ header, items, plural }) => {
      if (items.length === 0) return header;
      const verses = `${plural ? 'verses' : 'verse'} ${list(items)}`;
      return header === '' ? verses : `${header}, ${verses}`;
    })
    .join('; ');
  if (psalm) return text;
  return book.singleChapter ? `${book.name}, ${text}` : `${book.name} ${text}`;
}

/**
 * Formats a reference. `short` and `long` output parses back to the same
 * `Ref` with {@link parseRef}; a segment names its chapter after a semicolon
 * unless it continues the previous segment's chapter (`Gn 2:7–9; 3:1–7`,
 * `Ps 145:2–3, 8–9`). Throws a {@link RefError} for a malformed `Ref`.
 */
export function formatRef(ref: Ref, options: FormatOptions = {}): string {
  const book = checkRef(ref);
  const style = options.style ?? 'short';
  if (style === 'spoken') return spoken(book, ref.segments);
  const name = style === 'short' ? book.abbrev : book.code === 'PS' ? 'Psalm' : book.name;
  return written(book, name, ref.segments);
}
