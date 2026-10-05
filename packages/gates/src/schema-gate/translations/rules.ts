/**
 * The translation rules of gate 1 (schema, L-112), over `passages/i18n/<locale>/<key>.json`. Each
 * one has a negative fixture in `./fixtures/negative.ts`. Translations also reuse three passage
 * rules: `schema/sentence-cites-claim`, `schema/approved-has-reviewer` and
 * `schema/no-fake-provenance`.
 */
import { defineRule } from '../../core/rules.ts';

export const TRANSLATION_RULES = {
  validTranslation: defineRule(
    'schema/valid-translation',
    'Every passages/i18n/<locale>/<key>.json file is valid JSON and matches the translated-passage schema (@lectio/schema/translated-passage).',
    'Correct the field named in the message; a translation carries only the localised summary, context, note texts and claim texts, with the English ids.',
  ),
  translationOfExists: defineRule(
    'schema/translation-of-exists',
    'A translation sits at passages/i18n/<locale>/<translationOf>.json, with `locale` naming its directory, and the English passage passages/<translationOf>.json exists and is valid.',
    'Move or rename the file to match `locale` and `translationOf`, or add (or restore) the English passage it translates; delete translations of a removed passage.',
  ),
  translationMatchesSource: defineRule(
    'schema/translation-matches-source',
    'A translation lines up with its English passage: the same translation-note and claim ids, the same number of context paragraphs, and the same `[cN]` markers in each paragraph and note body.',
    'Translate every note and claim of the English file under its English id, keep the paragraphs one for one, and copy each claim marker to the matching place.',
  ),
  translationNotStale: defineRule(
    'schema/translation-not-stale',
    'A translation’s `sourceSha256` equals the hash of the English passage’s translatable fields, so it says what the English says now.',
    'Re-run `npm run research -- translate --locale <locale> --only <key>` (or update the translation by hand and set `sourceSha256` to translatableSha256 of the English file).',
  ),
  translationQuotedRun: defineRule(
    'schema/translation-quoted-run',
    'A quoted span in a translation is at most licenceGuard.maxQuotedWords words long (the licence guard’s quoted-run limit, applied to the translated text).',
    'Quote a single word or a short phrase, or say it in your own words; a Bible translation in any language is linked out, never quoted at length.',
  ),
  translationNeedsReview: defineRule(
    'schema/translation-needs-review',
    'Translations never auto-merge: every pending translation in a pull request waits for a person.',
    'Ask a configured reviewer to read the translation and approve it (`npm run review:approve`, the approval label or the approval comment).',
  ),
} as const;
