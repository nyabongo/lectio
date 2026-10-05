/**
 * Fixtures for the licence gate tests. Every text here is invented: no Bible translation and no
 * commentary is reproduced (ADR 0003). The "Bible" index in the tests is built from
 * {@link PSEUDO_SCRIPTURE}, an invented sentence, so the overlap rule can be exercised without
 * committing any real translation's wording.
 */

/** `n` distinct invented words: `w1 w2 … wn` (with a prefix to keep sets apart). */
export function words(n: number, prefix = 'w'): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1)}`).join(' ');
}

/** An invented 20-word sentence standing in for a public-domain Bible text. */
export const PSEUDO_SCRIPTURE =
  'Vintners gathered beside amber terraces while patient stewards counted silver tokens beneath ' +
  'quiet olive branches until dusk softened every weary field';

/** The first `n` words of {@link PSEUDO_SCRIPTURE}. */
export function scripture(n: number): string {
  return PSEUDO_SCRIPTURE.split(' ').slice(0, n).join(' ');
}

/** An invented commentary page; {@link commentaryRun} copies runs from it. */
export const PSEUDO_COMMENTARY =
  'In this parable the householder stands for a generous master whose hiring at every hour ' +
  'shows that reward rests on his goodness rather than on the length of labour performed in the heat';

/** The first `n` words of {@link PSEUDO_COMMENTARY}. */
export function commentaryRun(n: number): string {
  return PSEUDO_COMMENTARY.split(' ').slice(0, n).join(' ');
}

export const SOURCE_URL = 'https://commentary.example/matthew/20-1';
export const OTHER_URL = 'https://other.example/notes';
export const ARCHIVE_URL = 'https://web.archive.org/web/2026/https://gone.example/page';

export interface PassageParts {
  readonly summary?: string;
  readonly paragraphs?: readonly string[];
  readonly noteBody?: string;
  readonly gloss?: string;
  readonly claims?: readonly { readonly id: string; readonly text: string }[];
  readonly sources?: readonly Record<string, unknown>[];
}

/** A minimal passage-shaped object with the given prose; the licence gate reads only these fields. */
export function passage(parts: PassageParts = {}): Record<string, unknown> {
  return {
    key: 'MT.20.1-16',
    ref: 'Mt 20:1-16a',
    locale: 'en',
    summary: parts.summary ?? 'A landowner pays every worker the same.',
    context: { title: 'Labourers in the vineyard', paragraphs: parts.paragraphs ?? ['Only Matthew has it. [c1]'] },
    translationNotes: [
      {
        id: 'evil-eye',
        verse: '20:15',
        anchor: 'envious',
        original: {
          text: 'ὀφθαλμός σου πονηρός',
          lang: 'grc',
          translit: 'ophthalmos sou ponēros',
          gloss: parts.gloss ?? 'your eye evil',
        },
        summary: 'An idiom for begrudging.',
        body: parts.noteBody ?? 'The evil eye means stinginess. [c1]',
      },
    ],
    claims: (parts.claims ?? [{ id: 'c1', text: 'The parable appears only in Matthew.' }]).map((claim) => ({
      ...claim,
      sourceIds: ['s1'],
      sensitive: false,
    })),
    sources: parts.sources ?? [{ id: 's1', type: 'print', citation: 'A commentary' }],
    schemaVersion: 1,
  };
}

/** A web source entry. */
export function webSource(id: string, url: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, type: 'web', citation: `Source ${id}`, url, retrievedAt: '2026-10-05T07:00:00Z', ...extra };
}
