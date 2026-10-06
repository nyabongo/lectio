<!-- lectio-gates -->

## Lectio gates: a gate failed

| Gate                        | Status  | Details                                                                 |
| --------------------------- | ------- | ----------------------------------------------------------------------- |
| Schema tests (`schema`)     | Fail    | 19 errors, 2 warnings                                                   |
| Evidence tests (`evidence`) | Fail    | 5 errors, 3 warnings                                                    |
| Licence guard (`licence`)   | Fail    | 3 errors, 1 warning, 1 note                                             |
| LLM verifiers (`verifiers`) | Skipped | no live confirmer or refuter client (API key missing); a person reviews |

### Findings

#### Pull request

- **info** · `licence/pd-bible-overlap` (Licence guard): Limitation: The index only detects overlap with World English Bible and Douay-Rheims wording. Copyrighted modern translations (NABRE, RSV-2CE, Jerusalem Bible) are caught only where they share runs with those texts; the quoted-run rule, the research prompt rules and human review are the remaining safeguards.
  - Rule: No note text shares a run of licenceGuard.maxBibleRunWords or more words with a public-domain English Bible (World English Bible, Douay-Rheims).
  - Fix: Rewrite the sentence in your own words and point to the verse by reference instead of reproducing its wording.

#### `calendar/2026.json`

**Whole file**

- **error** · `schema/valid-calendar` (Schema tests) at `/days/0/date`: must fall in 2026
  - Rule: Every calendar/&lt;year&gt;.json file is valid JSON, matches the calendar-year schema, and lists its days in date order inside its year.
  - Fix: Correct the field named in the message, or rebuild the year with `npm run calendar:build`.

#### `calendar/2027.json`

**Whole file**

- **error** · `schema/calendar-keys-wellformed` (Schema tests) at `/days/0/masses/0/readings/1/key`: 2027-09-19 day gospel: ref "Mt 20:1-16a" is passage MT.20.1-16, but key is "MT.20.1-15"
  - Rule: Every calendar reading’s `key` is a canonical passage key and equals the key of its `ref`.
  - Fix: Rebuild the year with `npm run calendar:build`, or set the reading’s `key` to the key `toKey(parseRef(ref))` gives.

#### `passages/MT.20.1-17.json`

**Whole file**

- **error** · `schema/valid-passage` (Schema tests) at `/summary`: is required
  - Rule: Every passages/&lt;key&gt;.json file is valid JSON and matches the passage schema (@lectio/schema/passage).
  - Fix: Correct the field named in the message; docs/content-model.md lists every passage field and its shape.

#### `passages/MT.20.1-18a.json`

**Whole file**

- **error** · `schema/key-matches-filename` (Schema tests) at `/key`: key "MT.20.1-18" does not match the file name, which promises "MT.20.1-18a"
  - Rule: A passage file is named after its `key`, and a calendar file after its `year`.
  - Fix: Rename the file to passages/&lt;key&gt;.json (or calendar/&lt;year&gt;.json), or correct `key` / `year` inside it.

#### `passages/MT.20.1-19.json`

**Whole file**

- **error** · `schema/ref-parses` (Schema tests) at `/ref`: ref "Mt 21:1-19" is passage MT.21.1-19, not the file's key MT.20.1-19
  - Rule: Every reference parses: the passage `key` is canonical, `ref` parses to that key, and every scripture source and calendar reading `ref` parses.
  - Fix: Write the reference as the lectionary prints it (`Mt 20:1-16a`) and the key as `toKey` writes it (`MT.20.1-16`, ADR 0004).

#### `passages/MT.20.1-20.json`

**Whole file**

- **error** · `schema/ref-is-real-verse` (Schema tests) at `/sources/0/ref`: source dt-15-9 cites "Dt 15:99", which names a chapter or verse that does not exist
  - Rule: Every reference names verses that exist (original/NABRE versification, @lectio/refs L-006).
  - Fix: Check the chapter and verse numbers against a Bible; Psalms use the Hebrew numbering.

**Claim `c2`**

- **error** · `evidence/scripture-source-real` (Evidence tests) at `/sources/0/ref`: claim c2 cites source "dt-15-9", which cites “Dt 15:99”, which is not a real verse
  - Rule: Every scripture source cites real verses, and its Greek, Hebrew, Aramaic or Latin excerpt occurs in those verses of the corpus. An excerpt containing Greek or Hebrew script is checked as Greek or Hebrew whatever its excerptLang says (even `en`), and must be tagged grc, hbo or arc.
  - Fix: Correct the source’s ref to the verse it quotes, or copy the excerpt from that verse of the original text.

#### `passages/MT.20.1-21.json`

**Whole file**

- **error** · `schema/note-verse-in-passage` (Schema tests) at `/translationNotes/0/verse`: note evil-eye is on verse 21:15, which is outside MT.20.1-21
  - Rule: Every translation note’s `verse` falls inside the passage its file covers.
  - Fix: Correct the note’s `verse` (`chapter:verse`), or move the note to the passage that contains that verse.

**Claim `c2`**

- **error** · `evidence/original-word-in-verse` (Evidence tests) at `/translationNotes/0/original/text`: translation note "evil-eye" (claim c2) quotes “ὀφθαλμός σου πονηρός”, but “ὀφθαλμός”, “σου”, “πονηρός” do not occur in MT 21:15 (grc-sblgnt)
  - Rule: Every word a translation note quotes in the original language occurs in that verse of the corpus edition for its language.
  - Fix: Correct the note’s verse, or spell original.text as it stands in that verse (SBLGNT or LXX for Greek, OSHB for Hebrew and Aramaic, the Vulgate for Latin).

#### `passages/MT.20.1-22.json`

**Claim `c2`**

- **error** · `schema/claim-has-source` (Schema tests) at `/claims/1/sourceIds/1`: claim c2 cites source "lsj-ophthalmos", which is not in sources[]
  - Rule: Every claim cites at least one source, and every id in its `sourceIds` names a source in the same file.
  - Fix: Add the supporting source to `sources[]`, or correct the id in the claim’s `sourceIds`.

#### `passages/MT.20.1-23.json`

**Whole file**

- **error** · `schema/source-is-cited` (Schema tests) at `/sources/2`: source unused is not cited by any claim
  - Rule: Nothing is orphaned: every source is used by a claim, and every claim is cited by a `[cN]` marker in the text.
  - Fix: Remove the unused source or claim, or cite it where the text relies on it.
- **warning** · `evidence/print-source-flag` (Evidence tests) at `/sources/2`: source "unused" is a print source (An unused book) and cannot be checked automatically
  - Rule: A claim resting on a print source cannot be checked automatically, so it is flagged for a reviewer.
  - Fix: A reviewer checks the citation against the book. Where possible, also cite a web or scripture source the gate can check.

#### `passages/MT.20.1-24.json`

**Whole file**

- **error** · `schema/sentence-cites-claim` (Schema tests) at `/context/paragraphs/0`: sentence “Matthew alone records this parable.” carries no valid claim marker (markers look like [c1] or [c2][c3] and follow the closing punctuation)
  - Rule: Every sentence of every context paragraph and translation-note body ends with at least one `[cN]` marker naming a claim in the same file.
  - Fix: Add the marker of the claim that supports the sentence (`… a day’s wage. [c9]`), or add that claim; correct markers that name no claim.

#### `passages/MT.20.1-25.json`

**Whole file**

- **error** · `schema/unique-ids` (Schema tests) at `/claims/2/id`: claim id "c2" appears more than once
  - Rule: Ids are unique: claim, translation-note and source ids within a passage; dates within a calendar year; celebration and Mass ids within a day.
  - Fix: Rename or merge the duplicate; never renumber ids that are already published (see schema/note-ids-stable).

#### `passages/MT.20.1-26.json`

**Whole file**

- **error** · `schema/note-ids-stable` (Schema tests) at `/translationNotes`: translation-note id "evil-eye" exists on the base branch but not in this change
  - Rule: Every translation-note id and claim id on the base branch still exists after the change, because insight permalinks point at them.
  - Fix: Restore the removed or renamed id; add new notes and claims with new ids instead of reusing or renumbering old ones.

#### `passages/MT.20.1-27.json`

**Whole file**

- **error** · `schema/approved-has-reviewer` (Schema tests) at `/review/reviewers/0`: "someone-else" is not in config.reviewer.githubHandles (nyabongo)
  - Rule: An approved passage records a valid approval: a human approval by configured reviewers via cli, label or comment, or an auto approval whose verifier summary meets the auto-merge thresholds.
  - Fix: Set `review` back to `{ "status": "pending", "reviewers": [] }` and approve through `npm run review:approve`, the approval label or the approval comment.

#### `passages/MT.20.1-28.json`

**Whole file**

- **error** · `schema/no-fake-provenance` (Schema tests) at `/provenance/generator`: provenance.generator is "fake": this passage came from the fake provider
  - Rule: Content made by the fake generator never lands: `provenance.generator` is not `fake` and no model is `fake`.
  - Fix: Regenerate the passage with the research CLI and real providers (or mark a hand-written seed as `manual-seed`).
- **error** · `schema/no-fake-provenance` (Schema tests) at `/provenance/models/0`: provenance.models lists the fake model
  - Rule: Content made by the fake generator never lands: `provenance.generator` is not `fake` and no model is `fake`.
  - Fix: Regenerate the passage with the research CLI and real providers (or mark a hand-written seed as `manual-seed`).

#### `passages/MT.20.2-16.json`

**Claim `c1`**

- **error** · `evidence/web-excerpt-found` (Evidence tests) at `/sources/1/excerpt`: claim c1 cites source "householder-page", which quotes “told by Mark alone among the evangelists”, which is not on https://commentary.example.org/bad-week/matthew-20
  - Rule: Every web source’s excerpt appears in the page fetched from its URL (a page that cannot be fetched is flagged for review).
  - Fix: Copy the excerpt word for word from the page at the source URL (or its archivedUrl), or correct the URL. If the page is gone, add an archivedUrl.

#### `passages/MT.20.2-17.json`

**Claim `c2`**

- **error** · `evidence/scripture-source-real` (Evidence tests) at `/sources/2/excerpt`: claim c2 cites source "mt-20-14", which quotes “ὀφθαλμός”, which does not occur in Mt 20:14 (grc-sblgnt)
  - Rule: Every scripture source cites real verses, and its Greek, Hebrew, Aramaic or Latin excerpt occurs in those verses of the corpus. An excerpt containing Greek or Hebrew script is checked as Greek or Hebrew whatever its excerptLang says (even `en`), and must be tagged grc, hbo or arc.
  - Fix: Correct the source’s ref to the verse it quotes, or copy the excerpt from that verse of the original text.

#### `passages/MT.20.2-18.json`

**Claim `c2`**

- **error** · `evidence/original-word-in-verse` (Evidence tests) at `/translationNotes/0/original/text`: translation note "evil-eye" (claim c2) quotes “ὀφθαλμὸς σου πονηρρός”, but “πονηρρός” does not occur in MT 20:15 (grc-sblgnt)
  - Rule: Every word a translation note quotes in the original language occurs in that verse of the corpus edition for its language.
  - Fix: Correct the note’s verse, or spell original.text as it stands in that verse (SBLGNT or LXX for Greek, OSHB for Hebrew and Aramaic, the Vulgate for Latin).

#### `passages/MT.20.2-19.json`

**Claim `c1`**

- **warning** · `evidence/print-source-flag` (Evidence tests) at `/sources/1`: claim c1 cites source "householder-page", which is a print source (W. D. Davies and Dale C. Allison, The Gospel According to Saint Matthew, vol. 3 (ICC), T&amp;T Clark, 1997) and cannot be checked automatically
  - Rule: A claim resting on a print source cannot be checked automatically, so it is flagged for a reviewer.
  - Fix: A reviewer checks the citation against the book. Where possible, also cite a web or scripture source the gate can check.

#### `passages/MT.20.2-20.json`

**Claim `c1`**

- **error** · `licence/quoted-english-run` (Licence guard) at `/claims/0/text`: quotes 15 words of English (limit 10): “a parable told to the twelve about the…”. Lectio never reproduces a Bible translation or a commentary: it links out for the text and writes its own notes.
  - Rule: A quoted English span in a passage note is at most licenceGuard.maxQuotedWords words long.
  - Fix: Quote a single word or a short phrase, or say it in your own words; the reading itself is linked out, never quoted at length.

#### `passages/MT.20.2-21.json`

**Whole file**

- **error** · `licence/commentary-overlap` (Licence guard) at `/translationNotes/0/body`: 14 words are copied from https://commentary.example.org/bad-week/matthew-20 (cited as householder-page; limit 12): “Every labourer receives the same denarius whatever the…”. Lectio never reproduces a Bible translation or a commentary: it links out for the text and writes its own notes.
  - Rule: No note text shares a run of more than licenceGuard.maxCommentaryRunWords words with the fetched text of a cited web source.
  - Fix: Paraphrase the commentary in your own words; keep the source in sources[] and, if needed, a short excerpt.

#### `passages/MT.20.2-22.json`

**Whole file**

- **warning** · `licence/commentary-unchecked` (Licence guard) at `/sources/1`: source householder-page (https://commentary.example.org/bad-week/gone) could not be checked for copied wording: HTTP 404. An unchecked source never passes silently; a reviewer must compare the note with it.
  - Rule: Every cited web source can be fetched and read, so the note can be checked against it.
  - Fix: Fix the URL or add an archivedUrl that loads; otherwise a reviewer must compare the note with the source by hand.

**Claim `c1`**

- **warning** · `evidence/web-excerpt-found` (Evidence tests) at `/sources/1/url`: claim c1 cites source "householder-page", which could not be checked: fetching https://commentary.example.org/bad-week/gone returned HTTP 404
  - Rule: Every web source’s excerpt appears in the page fetched from its URL (a page that cannot be fetched is flagged for review).
  - Fix: Copy the excerpt word for word from the page at the source URL (or its archivedUrl), or correct the URL. If the page is gone, add an archivedUrl.

#### `passages/MT.20.2-23.json`

**Whole file**

- **error** · `licence/excerpt-length` (Licence guard) at `/sources/1/excerpt`: the excerpt of source householder-page is 31 words long (limit 25). An excerpt only shows where the claim comes from; a longer one starts to reproduce the source.
  - Rule: A source excerpt is at most licenceGuard.maxExcerptWords words long.
  - Fix: Trim the excerpt to the few words that support the claim.

#### `passages/i18n/sw/MT.20.1-14.json`

**Whole file**

- **error** · `schema/translation-of-exists` (Schema tests) at `/translationOf`: the English passage passages/MT.20.1-14.json does not exist
  - Rule: A translation sits at passages/i18n/&lt;locale&gt;/&lt;translationOf&gt;.json, with `locale` naming its directory, and the English passage passages/&lt;translationOf&gt;.json exists and is valid.
  - Fix: Move or rename the file to match `locale` and `translationOf`, or add (or restore) the English passage it translates; delete translations of a removed passage.

#### `passages/i18n/sw/MT.20.1-29.json`

**Whole file**

- **error** · `schema/valid-translation` (Schema tests) at `/sourceSha256`: is required
  - Rule: Every passages/i18n/&lt;locale&gt;/&lt;key&gt;.json file is valid JSON and matches the translated-passage schema (@lectio/schema/translated-passage).
  - Fix: Correct the field named in the message; a translation carries only the localised summary, context, note texts and claim texts, with the English ids.

#### `passages/i18n/sw/MT.20.1-31.json`

**Whole file**

- **error** · `schema/translation-matches-source` (Schema tests) at `/claims`: claims missing from the translation: c2
  - Rule: A translation lines up with its English passage: the same translation-note and claim ids, the same number of context paragraphs, and the same `[cN]` markers in each paragraph and note body.
  - Fix: Translate every note and claim of the English file under its English id, keep the paragraphs one for one, and copy each claim marker to the matching place.

#### `passages/i18n/sw/MT.20.1-32.json`

**Whole file**

- **warning** · `schema/translation-not-stale` (Schema tests) at `/sourceSha256`: the English passage MT.20.1-32 changed since this sw translation was made
  - Rule: A translation’s `sourceSha256` equals the hash of the English passage’s translatable fields, so it says what the English says now.
  - Fix: Re-run `npm run research -- translate --locale &lt;locale&gt; --only &lt;key&gt;` (or update the translation by hand and set `sourceSha256` to translatableSha256 of the English file).

#### `passages/i18n/sw/MT.20.1-33.json`

**Whole file**

- **error** · `schema/translation-quoted-run` (Schema tests) at `/claims/0/text`: quotes 13 words (limit 10): “mmoja wawili watatu wanne watano sita saba nane…”. Lectio links out for the reading text in every language.
  - Rule: A quoted span in a translation is at most licenceGuard.maxQuotedWords words long (the licence guard’s quoted-run limit, applied to the translated text).
  - Fix: Quote a single word or a short phrase, or say it in your own words; a Bible translation in any language is linked out, never quoted at length.

#### `passages/i18n/sw/MT.20.1-34.json`

**Whole file**

- **warning** · `schema/translation-needs-review` (Schema tests) at `/review`: the sw translation of MT.20.1-34 waits for a reviewer (translations never auto-merge)
  - Rule: Translations never auto-merge: every pending translation in a pull request waits for a person.
  - Fix: Ask a configured reviewer to read the translation and approve it (`npm run review:approve`, the approval label or the approval comment).

<sub>Base `origin/main` · head `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` · 35 changed files. Each finding names its rule; the fix says what to change.</sub>

### Merge rule: `blocked` (gates failed)

- the schema gate failed
- the evidence gate failed
- the licence gate failed
- passages/MT.20.1-27.json sets its review block to approved without a verified approval or a valid approval commit
- passages/i18n/sw/MT.20.1-14.json sets its review block to approved without a verified approval or a valid approval commit
- passages/i18n/sw/MT.20.1-29.json sets its review block to approved without a verified approval or a valid approval commit
- passages/i18n/sw/MT.20.1-31.json sets its review block to approved without a verified approval or a valid approval commit
- passages/i18n/sw/MT.20.1-32.json sets its review block to approved without a verified approval or a valid approval commit
- passages/i18n/sw/MT.20.1-33.json sets its review block to approved without a verified approval or a valid approval commit

Checked head: `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb` <!-- lectio-gates-head: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -->
