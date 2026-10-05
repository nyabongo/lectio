/**
 * Share-card inputs. The renderer takes display strings, not content files: the caller
 * (the site build, L-088) resolves a date through the calendar and passage files and passes
 * what the card shows. Card text is commentary, references and short original-language
 * phrases only, never reading text from a translation.
 */
import type { LiturgicalColour } from '@lectio/schema/common';

interface CardBase {
  /** The liturgical day, `YYYY-MM-DD`; shown as `Sunday 20 September 2026`. */
  readonly date: string;
  /** Liturgical colour of the day; tints the band. */
  readonly colour: LiturgicalColour;
  /** Absolute permalink; shown without the scheme in the footer. */
  readonly url: string;
}

/** `/[date]`: the day at a glance. */
export interface DayCard extends CardBase {
  readonly kind: 'day';
  /** Principal celebration, e.g. `Twenty-fifth Sunday in Ordinary Time`. */
  readonly celebration: string;
  /** Optional second line, e.g. `Year A · Ordinary Time, week 25`. */
  readonly subtitle?: string;
  /** Gospel reference as displayed, e.g. `Matthew 20:1–16`; omitted when the day has none yet. */
  readonly gospelRef?: string;
}

/** `/[date]/[slot]`: one reading by reference with its one-line summary. */
export interface ReadingCard extends CardBase {
  readonly kind: 'reading';
  /** Slot label as displayed, e.g. `Gospel`, `First reading`, `Psalm`. */
  readonly slotLabel: string;
  /** Reference as displayed, e.g. `Matthew 20:1–16`. */
  readonly ref: string;
  /** Lectio's own summary of the reading (commentary, not the text). */
  readonly summary: string;
}

/** Language of an original phrase: Koine Greek, Biblical Hebrew, Aramaic or Latin. */
export type OriginalLanguage = 'grc' | 'hbo' | 'arc' | 'la';

export interface OriginalPhrase {
  /** The phrase in its own script, e.g. `ὁ ὀφθαλμός σου πονηρός`. */
  readonly text: string;
  readonly language: OriginalLanguage;
  /** Latin-script transliteration; required to render a Hebrew phrase the card cannot lay out right to left. */
  readonly transliteration?: string;
}

/** `/[date]/[slot]/[noteId]`: one translation note. */
export interface InsightCard extends CardBase {
  readonly kind: 'insight';
  /** Short English anchor (a word or phrase, Lectio's own rendering), shown in quotation marks. */
  readonly quote: string;
  readonly original: OriginalPhrase;
  /** Slot label for the default caption, e.g. `Gospel`. */
  readonly slotLabel: string;
  /** Verse reference for the default caption, e.g. `Matthew 20:15`. */
  readonly ref: string;
  /** Overrides the default caption ({@link insightCaption}). */
  readonly caption?: string;
}

export type ShareCard = DayCard | ReadingCard | InsightCard;
export type CardKind = ShareCard['kind'];

export const LANGUAGE_NAMES: Readonly<Record<OriginalLanguage, string>> = {
  grc: 'Greek',
  hbo: 'Hebrew',
  arc: 'Aramaic',
  la: 'Latin',
};

/** `What the Greek of today's Gospel really says — Matthew 20:15`. */
export function insightCaption(card: Pick<InsightCard, 'original' | 'slotLabel' | 'ref'>): string {
  return `What the ${LANGUAGE_NAMES[card.original.language]} of today’s ${card.slotLabel} really says — ${card.ref}`;
}
