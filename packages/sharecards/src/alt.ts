/**
 * Alt text for a card (`og:image:alt`): what the card says, in one sentence or two, so a screen reader or a link
 * preview without images gets the same content. Fields are truncated with the card's own limits, so the alt text
 * never says more than the image shows. Pass the `omitOriginal` the card was rendered with, so the alt text leaves
 * the original phrase out when the card does.
 */
import { assertNever } from '@lectio/shared';

import { LANGUAGE_NAMES, insightCaption } from './cards.ts';
import type { ShareCard } from './cards.ts';
import { LIMITS } from './templates.ts';
import type { TemplateOptions } from './templates.ts';
import { formatLongDate, truncate } from './text.ts';

/** `Lectio card for Sunday 20 September 2026: Twenty-fifth Sunday in Ordinary Time. Gospel: Matthew 20:1–16.` */
export function cardAltText(card: ShareCard, options: Pick<TemplateOptions, 'omitOriginal'> = {}): string {
  const prefix = `Lectio card for ${formatLongDate(card.date)}`;
  switch (card.kind) {
    case 'day': {
      const parts = [`${prefix}: ${truncate(card.celebration, LIMITS.celebration)}.`];
      // `·` is read out as "middle dot" by some screen readers.
      if (card.subtitle !== undefined) {
        parts.push(`${truncate(card.subtitle, LIMITS.subtitle).replaceAll(' · ', ', ')}.`);
      }
      if (card.gospelRef !== undefined) parts.push(`Gospel: ${truncate(card.gospelRef, LIMITS.gospelRef)}.`);
      return parts.join(' ');
    }
    case 'reading':
      return (
        `${prefix}: ${truncate(card.slotLabel, LIMITS.slotLabel)}, ${truncate(card.ref, LIMITS.ref)}. ` +
        truncate(card.summary, LIMITS.summary)
      );
    case 'insight': {
      const quote = truncate(card.quote, LIMITS.quote - 2);
      const caption = truncate(card.caption ?? insightCaption(card), LIMITS.caption);
      if (options.omitOriginal === true) return `${prefix}: “${quote}”. ${caption}`;
      // The phrase as a reader can say it: the transliteration when there is one, else the phrase itself.
      const { language, text, transliteration } = card.original;
      const phrase = truncate(transliteration ?? text, LIMITS.original);
      return `${prefix}: “${quote}”. ${LANGUAGE_NAMES[language]}: ${phrase}. ${caption}`;
    }
    default:
      return assertNever(card);
  }
}
