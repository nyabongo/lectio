import { chapterLabel, isLetteredChapter } from '../greek-esther.ts';
import type { VerseId } from '../enumerate.ts';
import type { Versification } from './engine.ts';
import { VersificationError } from './errors.ts';

/**
 * A verse of Rahlfs's Septuagint Esther. Rahlfs prints the Greek additions inside
 * the Hebrew verse they follow, with sub-verse letters: C:12 is `4:17k`.
 */
export interface LxxVerse {
  readonly book: 'EST';
  readonly c: number;
  readonly v: number;
  /** The Rahlfs sub-verse letter (`k` in 4:17k); absent for a plain verse (D:1 is 5:1). */
  readonly part?: string;
}

/** `ESG 4:29 = ESG 4:17k`: one verse of the integrated ESG and its Rahlfs verse. */
const LINE = /^ESG (\d+):(\d+) = ESG (\d+):(\d+)([a-z]?)$/;

/**
 * Reads the single-verse ESG lines of libpalaso's eng.vrs, which map the
 * integrated Greek Esther (the additions counted as verses, as in org.vrs's
 * ESG) onto Rahlfs's lettered sub-verses. Returns `c:v` of the integrated
 * ESG → Rahlfs verse. Every verse of the lettered chapters but D:1 (Rahlfs
 * 5:1, the same number) has such a line.
 */
export function readRahlfsEsther(text: string): Map<string, LxxVerse> {
  const table = new Map<string, LxxVerse>();
  for (const line of text.split('\n')) {
    const match = LINE.exec(line.trim());
    if (!match) continue;
    const [, c, v, rc, rv, part] = match as unknown as [string, string, string, string, string, string];
    table.set(`${c}:${v}`, { book: 'EST', c: Number(rc), v: Number(rv), ...(part ? { part } : {}) });
  }
  return table;
}

/**
 * Builds {@link greekEstherLxx} over a versification and the eng.vrs text. The
 * package's default instance uses the embedded tables.
 */
export function createGreekEstherLxx(versification: Versification, engText: string): (verse: VerseId) => LxxVerse {
  let table: Map<string, LxxVerse> | undefined;
  return (verse) => {
    if (!isLetteredChapter(verse.book, verse.c) || !versification.isRealVerse(verse)) {
      throw new VersificationError(
        'UNKNOWN_VERSE',
        `${verse.book} ${chapterLabel(verse.book, verse.c)}:${String(verse.v)} is not a verse of Esther's lettered chapters (A–F)`,
      );
    }
    table ??= readRahlfsEsther(engText);
    const source = versification.toSourceVerse(verse);
    return table.get(`${String(source.c)}:${String(source.v)}`) ?? { book: 'EST', c: source.c, v: source.v };
  };
}
