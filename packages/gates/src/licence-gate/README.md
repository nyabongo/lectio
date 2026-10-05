# Gate 3: licence guard (`licence`, L-026)

No long verbatim run from an English Bible translation or from a cited commentary. Lectio carries commentary, never
the reading text ([ADR 0003](../../../../docs/adr/0003-never-store-reading-text.md)): readers open the text at a
licensed source.

The gate checks every passage file the pull request adds or changes, and every translation (see below). The prose it reads is the summary, the context
title and paragraphs, translation-note summaries, bodies and glosses, and claim texts. Claim markers (`[c1]`) are
ignored. Words are counted with the textguard tokeniser, so case, accents and punctuation do not matter, and
number-only tokens such as verse numbers are not words.

| Rule                           | Severity | Fails when                                                                                                                                                                                                                                                                                                                                                                                                                       | Limit (config)                            |
| ------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `licence/quoted-english-run`   | error    | a quoted span holds **more than** the limit of English (Latin-script) words. Double quotes form one family, so `“…”`, `"…"`, mismatched `“…"`, `„…“` and `”…”` all pair up; `«…»` and `‘…’`/`'…'` are detected too. A mark opens at the start of a word and closes at the end of one, so apostrophes and inch marks are not quotes. Quoted Greek or Hebrew does not count. An unclosed double quote runs to the end of the field | `licenceGuard.maxQuotedWords` (10)        |
| `licence/pd-bible-overlap`     | error    | a field shares a run of **at least** the limit with the public-domain Bible index (`corpus/guard/en-pd-<n>.bin`, L-013)                                                                                                                                                                                                                                                                                                          | `licenceGuard.maxBibleRunWords` (12)      |
| `licence/commentary-overlap`   | error    | a field shares **more than** the limit of consecutive words with the fetched text of a cited `web` source                                                                                                                                                                                                                                                                                                                        | `licenceGuard.maxCommentaryRunWords` (12) |
| `licence/commentary-unchecked` | warning  | a cited `web` source cannot be fetched (network error, HTTP error) or read (the fetcher's `unsupported` body, non-text content, an empty page, a page over 1,000,000 words, any error while processing it). It is flagged for review and never passes silently                                                                                                                                                                   | none                                      |
| `licence/excerpt-length`       | error    | a `sources[].excerpt` is **longer than** the limit                                                                                                                                                                                                                                                                                                                                                                               | `licenceGuard.maxExcerptWords` (25)       |
| `licence/guard-index`          | error    | the index cannot be loaded, or its shingle size or normaliser version does not match `licenceGuard.shingleSize` and textguard, or `maxBibleRunWords` is below the shingle size (a config error: the index cannot see shorter runs)                                                                                                                                                                                               | `licenceGuard.shingleSize` (8)            |

A value exactly at the limit passes, except for `licence/pd-bible-overlap`, where the issue sets the threshold as
"run ≥ `maxBibleRunWords`": a 12-word run fails and an 11-word run passes. Every limit is read from the config at run
time.

Each cited URL is fetched once per run through the `fetcher` provider, with `archivedUrl` as the fallback. When the
text comes from the archived copy, the message says so. `FetchedSource.text` is already reduced text (the live
fetcher, L-030, strips HTML and keeps the `text/html` content type), so the gate uses it as it is. Only a body that
is itself a whole HTML document (`<!doctype html` or `<html`) is reduced here, and numeric entities outside Unicode
become U+FFFD. Commentary overlap is exact: it finds the longest run of words shared with the page, in order. The page
is indexed as a suffix automaton over its words, so the work is linear in the page and in each note field, whatever
the words.

## Translations

Translations (`passages/i18n/<locale>/<key>.json`) are scanned too, with the checks that mean something for them:

| Rule                           | On a translation                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `licence/pd-bible-overlap`     | runs: it catches English public-domain Bible wording pasted into a translation (the translation's `gloss` is read too)                                              |
| `licence/commentary-overlap`   | runs against the `web` sources of the English passage, both the one the file name names and the one `translationOf` names (a translation has no sources of its own) |
| `licence/commentary-unchecked` | as for a passage; the finding sits on the translation and names the English file that cites the source                                                              |
| `licence/excerpt-length`       | runs, though a valid translation has no excerpts (gate 1 rejects a `sources` field)                                                                                 |
| `licence/quoted-english-run`   | does not run: gate 1 applies the same limit as `schema/translation-quoted-run`, so it is not reported twice                                                         |

Paths are matched in any letter case, and every file in a subdirectory of `passages/` counts as a translation here, so
a misplaced file (`passages/I18N/sw/…`, `passages/i18n/sw/nested/…`, `passages/other/…`) is still scanned. Gate 1
rejects such paths (`schema/translation-path`) and the merge rule holds them for a person.

What this does **not** cover: the public-domain index holds English Bibles only (WEB, Douay-Rheims). A modern Bible
translation in another language, such as a Kiswahili Bible, pasted without quotation marks is caught by nothing
automated. For translations the real safeguard is the mandatory human review: `merge-rule/translation-needs-person`
and `schema/translation-needs-review`. Every run that scans a translation says so (`TRANSLATION_LIMITATION`, an `info`
item and `meta.translationLimitation`). A hash-only shingle index of an openly licensed Kiswahili Bible would close
part of the gap; none is built yet.

## Limitation

Every run repeats this note in its output (an `info` item and `meta.limitation`), quoting textguard's `LIMITATION`:

> The index only detects overlap with World English Bible and Douay-Rheims wording. Copyrighted modern translations
> (NABRE, RSV-2CE, Jerusalem Bible) are caught only where they share runs with those texts; the quoted-run rule, the
> research prompt rules and human review are the remaining safeguards.

## Tests

- Unit tests (`*.test.ts` here) cover every rule with invented fixtures (`fixtures/cases.ts`), including the edge
  cases at each limit. The Bible check runs against an index built from an invented sentence, so no translation's
  wording is committed. They also run the real seed passage against the committed index.
- `tests/gates/03-licence.gate.test.ts` runs the gate over all committed content, one named test per rule. That suite
  is offline, so every cited web source is flagged `licence/commentary-unchecked`. The suite allows that flag and no
  errors.
