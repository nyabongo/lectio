/** A valid research passage for the publish tests: commentary, claims and sources only, no reading text. */
import type { Passage } from '@lectio/schema/passage';

export function researchPassage(overrides: Partial<Passage> = {}): Passage {
  return {
    key: 'MT.20.1-16',
    ref: 'Mt 20:1-16a',
    locale: 'en',
    summary: 'A landowner pays the last hired the same as the first, and asks whether his goodness is resented.',
    context: {
      title: 'Labourers in the vineyard',
      paragraphs: [
        'Matthew alone records this parable. [c1] The closing question uses the Jewish idiom of the evil eye. [c2]',
      ],
    },
    translationNotes: [
      {
        id: 'evil-eye',
        verse: '20:15',
        anchor: 'envious',
        original: {
          text: 'ὀφθαλμός σου πονηρός',
          lang: 'grc',
          translit: 'ophthalmos sou ponēros',
          gloss: 'your eye evil',
        },
        summary: 'Greek asks whether the eye is evil, an idiom for begrudging.',
        body: 'The evil eye was an image for stinginess (Deut 15:9). [c2]',
      },
    ],
    claims: [
      { id: 'c1', text: 'The parable appears only in Matthew.', sourceIds: ['davies-allison'], sensitive: false },
      { id: 'c2', text: 'An evil eye was an idiom for stinginess.', sourceIds: ['dt-15-9', 'lsj'], sensitive: true },
    ],
    sources: [
      { id: 'dt-15-9', type: 'scripture', citation: 'Deuteronomy 15:9', ref: 'Dt 15:9' },
      {
        id: 'lsj',
        type: 'web',
        citation: 'Liddell, Scott, Jones, s.v. ὀφθαλμός',
        url: 'https://www.perseus.tufts.edu/hopper/text?doc=lsj',
        retrievedAt: '2026-09-01T08:30:00Z',
      },
      { id: 'davies-allison', type: 'print', citation: 'Davies and Allison, Matthew, vol. 3 (ICC), 1997' },
    ],
    provenance: {
      generator: 'research-cli',
      runId: '2026-09-01-mt-20-1-16-a1b2c3',
      models: ['claude-opus-5-5'],
      promptVersion: 'research-v1',
      createdAt: '2026-09-01T08:42:10Z',
      costUsd: 0.84,
    },
    review: { status: 'pending', reviewers: [] },
    schemaVersion: 1,
    ...overrides,
  } as Passage;
}
