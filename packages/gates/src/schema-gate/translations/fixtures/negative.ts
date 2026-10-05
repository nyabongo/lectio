/**
 * Fixtures for the translation rules of gate 1: a Swahili translation of the gate-1 valid passage
 * (approved by the default configured reviewer, so it passes every rule), and for every
 * translation rule a negative fixture, a small pull request that breaks exactly that rule.
 * Commentary only: never reading text, in any language (ADR 0003).
 */
import type { Passage } from '@lectio/schema/passage';
import { translatableSha256 } from '@lectio/schema/translated-passage';

import { PASSAGE_PATH, added, validPassage } from '../../fixtures/negative.ts';
import type { PullRequestFixture } from '../../fixtures/negative.ts';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export const TRANSLATION_PATH = 'passages/i18n/sw/MT.20.1-16.json';

/** The configured reviewer of the default config. */
export const REVIEWER = 'nyabongo';

/** A Swahili translation of `validPassage()` that passes every rule. */
export function validTranslation(): Json {
  return {
    translationOf: 'MT.20.1-16',
    locale: 'sw',
    sourceSha256: translatableSha256(validPassage() as Passage),
    summary:
      'Mwenye shamba anawalipa walioajiriwa mwisho sawa na wa kwanza, na kuuliza kama wema wake ni sababu ya kinyongo.',
    context: {
      title: 'Wafanyakazi katika shamba la mizabibu',
      paragraphs: [
        'Mathayo peke yake anaandika mfano huu, katikati ya misemo miwili kuhusu wa mwisho kuwa wa kwanza. [c1] Swali la mwisho la mwenye shamba linatumia nahau ya Kiyahudi ya jicho ovu. [c2]',
      ],
    },
    translationNotes: [
      {
        id: 'evil-eye',
        anchor: 'wivu',
        gloss: 'jicho lako ovu',
        summary: 'Kigiriki kinauliza “je, jicho lako ni ovu?”, nahau ya kuonea wivu mema ya mwingine.',
        body: 'Jicho ovu lilikuwa picha inayojulikana ya ubahili na kinyongo (Kum 15:9). [c2] Tafsiri inabadilisha picha hiyo kuwa hisia tu. [c2]',
      },
    ],
    claims: [
      { id: 'c1', text: 'Mfano wa wafanyakazi katika shamba la mizabibu unapatikana katika Mathayo peke yake.' },
      { id: 'c2', text: '“Jicho ovu” ilikuwa nahau ya Kiyahudi ya ubahili au kuonea wivu mema ya mwingine.' },
    ],
    provenance: {
      generator: 'research-cli',
      runId: 'translate-fixture',
      models: ['claude-opus-5-5'],
      promptVersion: 'translate-v1',
      createdAt: '2026-10-05T07:50:00Z',
    },
    review: {
      status: 'approved',
      method: 'human',
      reviewers: [REVIEWER],
      approvedVia: 'label',
      lastReviewedAt: '2026-10-06T09:00:00Z',
    },
    schemaVersion: 1,
  };
}

/** A PR adding `translation` (default the valid one) next to the English passage at the head. */
export function withTranslation(
  edit: (translation: Json) => void = () => undefined,
  path = TRANSLATION_PATH,
): PullRequestFixture {
  const translation = validTranslation();
  edit(translation);
  const pr = added(path, translation);
  return { ...pr, head: { ...pr.head, [PASSAGE_PATH]: JSON.stringify(validPassage()) } };
}

/** A PR that changes the English passage and leaves its translation untouched. */
export function englishChanged(edit: (passage: Json) => void): PullRequestFixture {
  const passage = validPassage();
  edit(passage);
  return {
    head: { [PASSAGE_PATH]: JSON.stringify(passage), [TRANSLATION_PATH]: JSON.stringify(validTranslation()) },
    changed: [{ path: PASSAGE_PATH, status: 'modified' }],
    base: { [PASSAGE_PATH]: JSON.stringify(validPassage()) },
  };
}

/** For every translation rule, a pull request that breaks exactly that rule. */
export const TRANSLATION_NEGATIVE_FIXTURES: Readonly<Record<string, PullRequestFixture>> = {
  'schema/valid-translation': withTranslation((t) => {
    delete t['sourceSha256'];
  }),
  'schema/translation-of-exists': withTranslation((t) => {
    t['translationOf'] = 'MT.20.1-15';
  }, 'passages/i18n/sw/MT.20.1-15.json'),
  'schema/translation-matches-source': withTranslation((t) => {
    t['claims'].pop();
  }),
  'schema/translation-not-stale': englishChanged((p) => {
    p['summary'] = 'A landowner pays every labourer the same wage, whenever they were hired.';
  }),
  'schema/translation-quoted-run': withTranslation((t) => {
    t['claims'][0]['text'] =
      'Mathayo anaandika “mmoja wawili watatu wanne watano sita saba nane tisa kumi kumi na moja”.';
  }),
  'schema/translation-needs-review': withTranslation((t) => {
    t['review'] = { status: 'pending', reviewers: [] };
  }),
};
