# Gate 3: licence guard (`licence`, L-026)

No long verbatim run from an English Bible translation or from a cited commentary. Lectio carries commentary, never
the reading text ([ADR 0003](../../../../docs/adr/0003-never-store-reading-text.md)): readers open the text at a
licensed source.

The gate checks every passage file the pull request adds or changes. The prose it reads is the summary, the context
title and paragraphs, translation-note summaries, bodies and glosses, and claim texts. Claim markers (`[c1]`) are
ignored. Words are counted with the textguard tokeniser, so case, accents and punctuation do not matter, and
number-only tokens such as verse numbers are not words.

| Rule                           | Severity | Fails when                                                                                                                                                                                             | Limit (config)                            |
| ------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `licence/quoted-english-run`   | error    | a quoted span (`“…”`, `"…"`, `«…»`, `‘…’`) holds **more than** the limit of English (Latin-script) words. Quoted Greek or Hebrew does not count. An unclosed double quote runs to the end of the field | `licenceGuard.maxQuotedWords` (10)        |
| `licence/pd-bible-overlap`     | error    | a field shares a run of **at least** the limit with the public-domain Bible index (`corpus/guard/en-pd-<n>.bin`, L-013)                                                                                | `licenceGuard.maxBibleRunWords` (12)      |
| `licence/commentary-overlap`   | error    | a field shares **more than** the limit of consecutive words with the fetched text of a cited `web` source                                                                                              | `licenceGuard.maxCommentaryRunWords` (12) |
| `licence/commentary-unchecked` | warning  | a cited `web` source cannot be fetched (network error, HTTP error) or read (non-text content, empty page). It is flagged for review and never passes silently                                          | none                                      |
| `licence/excerpt-length`       | error    | a `sources[].excerpt` is **longer than** the limit                                                                                                                                                     | `licenceGuard.maxExcerptWords` (25)       |
| `licence/guard-index`          | error    | the index cannot be loaded, or its shingle size or normaliser version does not match `licenceGuard.shingleSize` and textguard                                                                          | `licenceGuard.shingleSize` (8)            |

A value exactly at the limit passes, except for `licence/pd-bible-overlap`, where the issue sets the threshold as
"run ≥ `maxBibleRunWords`": a 12-word run fails and an 11-word run passes. Every limit is read from the config at run
time.

Each cited URL is fetched once per run through the `fetcher` provider, with `archivedUrl` as the fallback. When the
text comes from the archived copy, the message says so. HTML that reaches the gate is reduced to text first.
Commentary overlap is exact: it finds the longest run of words shared with the page, in order.

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
