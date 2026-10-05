/**
 * The rules of gate 1 (schema). Each one has a negative fixture in `./fixtures/negative.ts` and a
 * named test over the repository content in `tests/gates/01-schema.gate.test.ts`.
 */
import { defineRule } from '../core/rules.ts';

export const SCHEMA_RULES = {
  validPassage: defineRule(
    'schema/valid-passage',
    'Every passages/<key>.json file is valid JSON and matches the passage schema (@lectio/schema/passage).',
    'Correct the field named in the message; docs/content-model.md lists every passage field and its shape.',
  ),
  validCalendar: defineRule(
    'schema/valid-calendar',
    'Every calendar/<year>.json file is valid JSON, matches the calendar-year schema, and lists its days in date order inside its year.',
    'Correct the field named in the message, or rebuild the year with `npm run calendar:build`.',
  ),
  keyMatchesFilename: defineRule(
    'schema/key-matches-filename',
    'A passage file is named after its `key`, and a calendar file after its `year`.',
    'Rename the file to passages/<key>.json (or calendar/<year>.json), or correct `key` / `year` inside it.',
  ),
  refParses: defineRule(
    'schema/ref-parses',
    'Every reference parses: the passage `key` is canonical, `ref` parses to that key, and every scripture source and calendar reading `ref` parses.',
    'Write the reference as the lectionary prints it (`Mt 20:1-16a`) and the key as `toKey` writes it (`MT.20.1-16`, ADR 0004).',
  ),
  refIsRealVerse: defineRule(
    'schema/ref-is-real-verse',
    'Every reference names verses that exist (original/NABRE versification, @lectio/refs L-006).',
    'Check the chapter and verse numbers against a Bible; Psalms use the Hebrew numbering.',
  ),
  noteVerseInPassage: defineRule(
    'schema/note-verse-in-passage',
    'Every translation note’s `verse` falls inside the passage its file covers.',
    'Correct the note’s `verse` (`chapter:verse`), or move the note to the passage that contains that verse.',
  ),
  claimHasSource: defineRule(
    'schema/claim-has-source',
    'Every claim cites at least one source, and every id in its `sourceIds` names a source in the same file.',
    'Add the supporting source to `sources[]`, or correct the id in the claim’s `sourceIds`.',
  ),
  sourceIsCited: defineRule(
    'schema/source-is-cited',
    'Nothing is orphaned: every source is used by a claim, and every claim is cited by a `[cN]` marker in the text.',
    'Remove the unused source or claim, or cite it where the text relies on it.',
  ),
  sentenceCitesClaim: defineRule(
    'schema/sentence-cites-claim',
    'Every sentence of every context paragraph and translation-note body ends with at least one `[cN]` marker naming a claim in the same file.',
    'Add the marker of the claim that supports the sentence (`… a day’s wage. [c9]`), or add that claim; correct markers that name no claim.',
  ),
  uniqueIds: defineRule(
    'schema/unique-ids',
    'Ids are unique: claim, translation-note and source ids within a passage; dates within a calendar year; celebration and Mass ids within a day.',
    'Rename or merge the duplicate; never renumber ids that are already published (see schema/note-ids-stable).',
  ),
  noteIdsStable: defineRule(
    'schema/note-ids-stable',
    'Every translation-note id and claim id on the base branch still exists after the change, because insight permalinks point at them.',
    'Restore the removed or renamed id; add new notes and claims with new ids instead of reusing or renumbering old ones.',
  ),
  approvedHasReviewer: defineRule(
    'schema/approved-has-reviewer',
    'An approved passage records a valid approval: a human approval by configured reviewers via cli, label or comment, or an auto approval whose verifier summary meets the auto-merge thresholds.',
    'Set `review` back to `{ "status": "pending", "reviewers": [] }` and approve through `npm run review:approve`, the approval label or the approval comment.',
  ),
  noFakeProvenance: defineRule(
    'schema/no-fake-provenance',
    'Content made by the fake generator never lands: `provenance.generator` is not `fake` and no model is `fake`.',
    'Regenerate the passage with the research CLI and real providers (or mark a hand-written seed as `manual-seed`).',
  ),
  calendarKeysWellformed: defineRule(
    'schema/calendar-keys-wellformed',
    'Every calendar reading’s `key` is a canonical passage key and equals the key of its `ref`.',
    'Rebuild the year with `npm run calendar:build`, or set the reading’s `key` to the key `toKey(parseRef(ref))` gives.',
  ),
} as const;
