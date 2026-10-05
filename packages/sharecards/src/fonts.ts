/**
 * The bundled fonts (all SIL Open Font License 1.1; licences and provenance in `../fonts/`).
 *
 * Satori picks one font file per family name, weight and style, so each Unicode subset is
 * registered under its own family name and the stacks below list them in fallback order.
 * Nothing is read from the system: the same files render the same pixels on every machine.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Font } from 'satori';

export interface FontFile {
  /** Family name the templates refer to. */
  readonly name: string;
  /** File in the fonts directory. */
  readonly file: string;
  readonly weight: 400 | 500 | 600;
  readonly style: 'normal' | 'italic';
}

export const FONT_FILES: readonly FontFile[] = [
  { name: 'Cormorant Garamond', file: 'cormorant-garamond-latin-600-normal.woff', weight: 600, style: 'normal' },
  { name: 'Cormorant Garamond', file: 'cormorant-garamond-latin-600-italic.woff', weight: 600, style: 'italic' },
  {
    name: 'Cormorant Garamond Ext',
    file: 'cormorant-garamond-latin-ext-600-normal.woff',
    weight: 600,
    style: 'normal',
  },
  {
    name: 'Cormorant Garamond Ext',
    file: 'cormorant-garamond-latin-ext-600-italic.woff',
    weight: 600,
    style: 'italic',
  },
  { name: 'Source Sans 3', file: 'source-sans-3-latin-400-normal.woff', weight: 400, style: 'normal' },
  { name: 'Source Sans 3', file: 'source-sans-3-latin-600-normal.woff', weight: 600, style: 'normal' },
  { name: 'Source Sans 3 Ext', file: 'source-sans-3-latin-ext-400-normal.woff', weight: 400, style: 'normal' },
  { name: 'Source Sans 3 Ext', file: 'source-sans-3-latin-ext-600-normal.woff', weight: 600, style: 'normal' },
  { name: 'Noto Serif Greek', file: 'noto-serif-greek-500-normal.woff', weight: 500, style: 'normal' },
  { name: 'Noto Serif Greek Ext', file: 'noto-serif-greek-ext-500-normal.woff', weight: 500, style: 'normal' },
  { name: 'Noto Serif Hebrew', file: 'noto-serif-hebrew-hebrew-500-normal.woff', weight: 500, style: 'normal' },
];

const SCRIPT_FALLBACKS = ["'Noto Serif Greek'", "'Noto Serif Greek Ext'", "'Noto Serif Hebrew'"];

/** Display serif: titles, references, the anchor quote. */
export const SERIF_STACK = ["'Cormorant Garamond'", "'Cormorant Garamond Ext'", ...SCRIPT_FALLBACKS].join(', ');
/** Text sans: dates, labels, summaries, captions, URLs. */
export const SANS_STACK = ["'Source Sans 3'", "'Source Sans 3 Ext'", ...SCRIPT_FALLBACKS].join(', ');
/** Polytonic Greek original phrases. */
export const GREEK_STACK = ["'Noto Serif Greek'", "'Noto Serif Greek Ext'", "'Cormorant Garamond'"].join(', ');
/** Hebrew (and Aramaic) original phrases. */
export const HEBREW_STACK = ["'Noto Serif Hebrew'", "'Cormorant Garamond'"].join(', ');

/** The package's `fonts/` directory. */
export const DEFAULT_FONTS_DIR = fileURLToPath(new URL('../fonts/', import.meta.url));

const cache = new Map<string, Promise<Font[]>>();

/**
 * Reads every bundled font from `dir` (default: the package's `fonts/`). Memoised per
 * directory, so a build that renders hundreds of cards reads each file once.
 */
export function loadFonts(dir: string = DEFAULT_FONTS_DIR): Promise<Font[]> {
  let fonts = cache.get(dir);
  if (!fonts) {
    fonts = Promise.all(
      FONT_FILES.map(async ({ name, file, weight, style }) => ({
        name,
        weight,
        style,
        data: await readFile(join(dir, file)),
      })),
    );
    // A failed read (wrong directory) must not poison later calls.
    fonts.catch(() => cache.delete(dir));
    cache.set(dir, fonts);
  }
  return fonts;
}
