/**
 * Known, documented gaps in the lectionary data that `calendar:report` (L-070) allows. Each one names
 * the day (month and day) and the celebration whose readings are missing; nothing else on that date,
 * and no other celebration, is allowed. Remove an entry as soon as its readings are added: the report
 * says when an allowed gap has been filled.
 */
export interface KnownGap {
  /** `MM-DD`. */
  readonly monthDay: string;
  /** The day's principal celebration (the first in its list). */
  readonly celebrationId: string;
  /** Why the readings are missing and what would fill them. */
  readonly reason: string;
}

export const KNOWN_GAPS: readonly KnownGap[] = [
  {
    monthDay: '04-30',
    celebrationId: 'our-lady-mother-of-africa',
    reason:
      'Kenya proper (feast): no open source has its readings; they need the Kenyan Daily Missal ' +
      '(docs/decisions/011-lectionary-source.md, Q5)',
  },
];
