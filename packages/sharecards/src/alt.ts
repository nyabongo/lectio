/**
 * Alt text for a card (`og:image:alt`): what the card says, in one sentence or two, so a screen reader or a link
 * preview without images gets the same content. Fields are truncated with the card's own limits, so the alt text
 * never says more than the image shows.
 */
import { assertNever } from '@lectio/shared';

import { LANGUAGE_NAMES, insightCaption } from './cards.ts';
import type { ShareCard } from './cards.ts';
import { LIMITS } from './templates.ts';
import { formatLongDate, truncate } from './text.ts';

/** `Lectio card for Sunday 20 September 2026: Twenty-fifth Sunday in Ordinary Time. Gospel: Matthew 20:1–16.` */
export function cardAltText(card: ShareCard): string {
  const prefix = `Lectio card for ${formatLongDate(card.date)}`;
  switch (card.kind) {
    case 'day': {
      const parts = [`${prefix}: ${truncate(card.celebration, LIMITS.celebration)}.`];
      if (card.subtitle !== undefined) parts.push(`${truncate(card.subtitle, LIMITS.subtitle)}.`);
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
      return `${prefix}: “${quote}”, a note on the ${LANGUAGE_NAMES[card.original.language]}. ${caption}`;
    }
    default:
      return assertNever(card);
  }
}
