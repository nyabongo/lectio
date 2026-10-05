/**
 * Golden fixtures. Card text is Lectio-style commentary, references and short original-language
 * phrases (Greek from Mt 20:15, Hebrew from Deut 15:9); no translation's reading text.
 */
import type { DayCard, InsightCard, ReadingCard } from '../cards.ts';

export const dayFixture: DayCard = {
  kind: 'day',
  date: '2026-09-20',
  colour: 'green',
  url: 'https://lectio.example/2026-09-20',
  celebration: 'Twenty-fifth Sunday in Ordinary Time',
  subtitle: 'Year A · Ordinary Time, week 25',
  gospelRef: 'Matthew 20:1–16',
};

export const readingFixture: ReadingCard = {
  kind: 'reading',
  date: '2026-09-20',
  colour: 'green',
  url: 'https://lectio.example/2026-09-20/gospel',
  slotLabel: 'Gospel',
  ref: 'Matthew 20:1–16',
  summary:
    'Labourers hired at dawn and at the eleventh hour are paid the same. The parable turns on what “good” means, and on who God is.',
};

export const insightFixture: InsightCard = {
  kind: 'insight',
  date: '2026-09-20',
  colour: 'green',
  url: 'https://lectio.example/2026-09-20/gospel/evil-eye',
  quote: 'Is your eye evil?',
  original: { text: 'ὁ ὀφθαλμός σου πονηρός ἐστιν', language: 'grc' },
  slotLabel: 'Gospel',
  ref: 'Matthew 20:15',
};

/** Not one of the three golden fixtures: used to check right-to-left Hebrew on a full card. */
export const hebrewInsightFixture: InsightCard = {
  kind: 'insight',
  date: '2026-09-20',
  colour: 'green',
  url: 'https://lectio.example/2026-09-20/gospel/evil-eye',
  quote: 'An evil eye',
  original: { text: 'וְרָעָה עֵינְךָ', language: 'hbo', transliteration: 'wə-rā‘â ‘ênəkā' },
  slotLabel: 'Gospel',
  ref: 'Matthew 20:15',
  caption: 'The same idiom in Deuteronomy 15:9, which Matthew’s hearers knew',
};
