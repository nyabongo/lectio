/**
 * Checks the committed corpus/grc-lxx (not a fixture) against the `lxx` scheme, so a re-import whose verse numbering
 * drifts from the scheme fails the build.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chapterCount, chapterLength, greekEstherLxx, isRealVerse, letteredChapter } from '@lectio/refs';
import type { GreekEstherLetter } from '@lectio/refs';
import type { BookCode } from '@lectio/refs';
import { describe, expect, it } from 'vitest';

import { parseChapter, parseSource } from '../format.ts';
import type { ChapterVerses } from '../format.ts';
import { normaliseGreek } from '../normalise.ts';
import { ESTHER_ADDITIONS, LXX_BOOKS, LXX_EDITION } from './lxx.ts';

const edition = fileURLToPath(new URL(`../../../../corpus/${LXX_EDITION}`, import.meta.url));
const BOOK_CODES = [...new Set(LXX_BOOKS.map((part) => part.book))];

/** Verses of the `lxx` scheme this edition has no text for (reviewed): lacunae and the verses Esther D replaces. */
const GAPS = ['DN 3:67', 'DN 3:68', 'EST 5:1', 'EST 5:2', 'TB 4:7'];

/** Greek Esther's additions: NABRE lettered chapter → number of verses. */
const ESTHER_LETTERS = { A: 17, B: 7, C: 30, D: 16, E: 24, F: 11 };

/**
 * How lxx verses begin (normalised), above all in the chapters re-divided from Swete's numbering, checked against
 * Rahlfs' verse divisions.
 */
const ANCHORS: Readonly<Record<string, string>> = {
  'TB 5:23': 'και εσιγησεν',
  'TB 6:1': 'και εξηλθεν το παιδιον',
  'TB 10:14': 'και απηλθεν τωβιασ',
  'TB 11:19': 'και παρεγενοντο αχεικαρ',
  'TB 13:11': 'και παλιν η σκηνη',
  'TB 13:17': 'οτι ιερουσαλημ',
  'EST 9:31': 'και μαρδοχαιοσ και εσθηρ',
  'EST 9:32': 'και εσθηρ λογω',
  'WIS 3:1': 'δικαιων δε ψυχαι',
  'WIS 17:10': 'δειλον γαρ ιδιωσ',
  'WIS 17:20': 'μονοισ δε εκεινοισ',
  'SIR 1:1': 'πασα σοφια',
  'SIR 22:9': 'συνκολλων οστρακον',
  'SIR 24:1': 'αινεσισ σοφιασ',
  'SIR 29:17': 'εγγυη πολλουσ',
  'SIR 30:25': 'λαμπρα καρδια',
  'SIR 31:1': 'αγρυπνια πλουτου',
  'SIR 33:1': 'τω φοβουμενω κυριον',
  'SIR 33:16': 'καγω εσχατοσ ηγρυπνησα ωσ καλαμωμενοσ',
  'SIR 33:17': 'εν ευλογια κυριου',
  'SIR 33:25': 'χορτασματα και ραβδοσ',
  'SIR 33:33': 'εαν κακωσησ',
  'SIR 34:1': 'κεναι ελπιδεσ',
  'SIR 34:21': 'αρτοσ επιδεομενων',
  'SIR 34:26': 'ουτωσ ανθρωποσ νηστευων',
  'SIR 35:1': 'ο συντηρων νομον',
  'SIR 35:12': 'οτι κυριοσ κριτησ',
  'SIR 35:17': 'προσευχη ταπεινου',
  'SIR 35:24': 'ωραιον ελεοσ',
  'SIR 36:1': 'ελεησον ημασ',
  'SIR 36:11': 'ελεησον λαον',
  'SIR 36:27': 'ουτωσ ανθρωπω',
  'SIR 41:24': 'απο περιεργειασ',
  'SIR 42:1': 'μη περι τουτων',
  'BAR 6:1': 'αντιγραφον επιστολησ',
  'DN 3:54': 'ευλογημενοσ ει επι θρονου',
  'DN 3:55': 'ευλογημενοσ ει ο επιβλεπων',
  'DN 4:1': 'ναβουχοδονοσορ ο βασιλευσ',
  'DN 6:1': 'και δαρειοσ ο μηδοσ',
  'DN 14:12': 'αυτοι δε κατεφρονουν',
};

async function chapters(book: string): Promise<Map<string, ChapterVerses>> {
  const files = await readdir(join(edition, book));
  const out = new Map<string, ChapterVerses>();
  for (const file of files) {
    const where = `${book}/${file}`;
    out.set(
      file.replace(/\.json$/u, ''),
      parseChapter(JSON.parse(await readFile(join(edition, where), 'utf8')), where),
    );
  }
  return out;
}

describe(`corpus/${LXX_EDITION}`, () => {
  it('declares the lxx versification', async () => {
    const source = parseSource(JSON.parse(await readFile(join(edition, 'SOURCE.json'), 'utf8')), 'SOURCE.json');
    expect(source.versification).toBe('lxx');
  });

  it.each(BOOK_CODES)('%s has exactly the verses of the lxx scheme, less the reviewed gaps', async (book) => {
    const stored = await chapters(book);
    const numbered = [...stored.keys()].filter((c) => /^[0-9]+$/u.test(c));
    expect(numbered.length).toBe(chapterCount(book as BookCode, 'lxx'));
    const missing: string[] = [];
    const extra: string[] = [];
    for (let c = 1; c <= chapterCount(book as BookCode, 'lxx'); c += 1) {
      const verses = stored.get(String(c)) ?? {};
      for (const v of Object.keys(verses)) {
        if (!isRealVerse({ book: book as BookCode, c, v: Number(v) }, 'lxx')) extra.push(`${book} ${c}:${v}`);
      }
      for (let v = 1; v <= (chapterLength(book as BookCode, c, 'lxx') as number); v += 1) {
        if (isRealVerse({ book: book as BookCode, c, v }, 'lxx') && !(String(v) in verses)) {
          missing.push(`${book} ${c}:${v}`);
        }
      }
    }
    expect(extra).toEqual([]);
    expect(missing).toEqual(GAPS.filter((gap) => gap.startsWith(`${book} `)));
  });

  it("stores Greek Esther's additions as the NABRE lettered chapters", async () => {
    const stored = await chapters('EST');
    for (const [letter, count] of Object.entries(ESTHER_LETTERS)) {
      expect(Object.keys(stored.get(letter) ?? {}).sort((a, b) => Number(a) - Number(b))).toEqual(
        Array.from({ length: count }, (_, i) => String(i + 1)),
      );
    }
  });

  it.each(Object.keys(ESTHER_LETTERS) as GreekEstherLetter[])(
    "Esther %s (Swete's lettering) agrees with the Rahlfs mapping of greekEstherLxx",
    async (letter) => {
      const verses = Object.keys((await chapters('EST')).get(letter) ?? {}).map(Number);
      const c = letteredChapter(letter);
      // As many verses as @lectio/refs gives the lettered chapter.
      expect(verses).toHaveLength(chapterLength('EST', c) as number);
      // Swete prints each addition inside the Hebrew verse it follows; Rahlfs maps every verse there.
      const hosts = Object.entries(ESTHER_ADDITIONS).flatMap(([verse, held]) => (held === letter ? [verse] : []));
      const rahlfs = verses.sort((a, b) => a - b).map((v) => greekEstherLxx({ book: 'EST', c, v }));
      expect(rahlfs.filter((verse) => !hosts.includes(`${String(verse.c)}:${String(verse.v)}`))).toEqual([]);
      // In the same order: Rahlfs' sub-verse letters never go back.
      const order = rahlfs.map((verse) => `${String(verse.v).padStart(3, '0')}${verse.part ?? ''}`);
      expect(order).toEqual([...order].sort());
    },
  );

  it.each(Object.entries(ANCHORS))('%s begins "%s"', async (ref, anchor) => {
    const [, book, c, v] = /^(\S+) (\S+):(\S+)$/u.exec(ref) as unknown as [string, string, string, string];
    const verses = (await chapters(book)).get(c) ?? {};
    const text = normaliseGreek((verses[v] ?? []).map((token) => token[0]).join(' '));
    expect(text.startsWith(anchor)).toBe(true);
  });
});
