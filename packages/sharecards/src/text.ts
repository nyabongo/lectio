/**
 * Text preparation for share cards: normalisation, truncation, dates, URLs and Hebrew
 * visual ordering. Everything here is pure and deterministic (no locale data from ICU),
 * so the same input always produces the same card.
 */
import { isIsoDate } from '@lectio/shared';

const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** User-perceived characters (a base letter with its accents or vowel points counts once). */
export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment);
}

/** NFC, every whitespace run collapsed to one space, trimmed. */
export function normalise(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Punctuation and spaces dropped from the end of a cut before the ellipsis is added. */
const TRAILING_JUNK = /[\s,;:.\-–—'"“‘(]+$/u;

/**
 * Truncation rule shared by every card field: normalise, and when the text is longer than
 * `max` graphemes, cut it to at most `max - 1`, back off to the last word boundary when that
 * keeps at least 60% of the budget, strip trailing punctuation and append `…`. The result is
 * never longer than `max` graphemes.
 */
export function truncate(text: string, max: number): string {
  if (!Number.isInteger(max) || max < 2) throw new RangeError(`max must be an integer ≥ 2, got ${String(max)}`);
  const clean = normalise(text);
  const chars = graphemes(clean);
  if (chars.length <= max) return clean;
  const head = chars.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  const kept = space >= Math.floor(max * 0.6) ? head.slice(0, space) : head;
  return `${kept.join('').replace(TRAILING_JUNK, '')}…`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** `2026-09-20` → `Sunday 20 September 2026` (the brief's date style). */
export function formatLongDate(date: string): string {
  if (!isIsoDate(date)) throw new RangeError(`Not an ISO date (YYYY-MM-DD): ${JSON.stringify(date)}`);
  const utc = new Date(`${date}T00:00:00Z`);
  const weekday = WEEKDAYS[utc.getUTCDay()] as string;
  const month = MONTHS[utc.getUTCMonth()] as string;
  return `${weekday} ${String(utc.getUTCDate())} ${month} ${String(utc.getUTCFullYear())}`;
}

/** `https://lectio.example/2026-09-20/gospel/` → `lectio.example/2026-09-20/gospel`. */
export function displayUrl(url: string): string {
  if (!URL.canParse(url)) throw new RangeError(`Not an absolute URL: ${JSON.stringify(url)}`);
  const parsed = new URL(url);
  return `${parsed.host}${parsed.pathname}`.replace(/\/+$/u, '');
}

/** Any Hebrew-block letter (also used for Aramaic). */
const HEBREW_LETTER = /[\u05D0-\u05EA\u05EF-\u05F2\uFB1D-\uFB4F]/u;
/** A phrase made only of Hebrew letters, points, cantillation, maqaf, sof pasuq, geresh and spaces. */
const PURE_HEBREW = /^[\u0591-\u05F4\uFB1D-\uFB4F ]+$/u;

/** True when `text` contains at least one Hebrew letter. */
export function hasHebrew(text: string): boolean {
  return HEBREW_LETTER.test(text);
}

/**
 * Satori shapes the letters inside one Hebrew word right to left, but lays a run of several
 * words out left to right and moves the spaces to the start of the line (checked pixel by
 * pixel in render.test.ts). For a purely Hebrew phrase this returns its words in visual order,
 * first word last, for the caller to place one flex item per word left to right. Returns `null`
 * when the phrase mixes in another script, digits or Latin punctuation, where full bidi would
 * be needed: the caller falls back to the transliteration.
 */
export function hebrewVisualWords(text: string): string[] | null {
  const clean = normalise(text);
  if (!hasHebrew(clean) || !PURE_HEBREW.test(clean)) return null;
  return clean.split(' ').reverse();
}
