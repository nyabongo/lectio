# 012 · Septuagint source for the deuterocanonical books (L-071)

- **Status:** Accepted by the owner, 2026-10-05.
- **Issue:** #68 (roadmap id L-071), PR #149
- **Implemented by:** `packages/corpus/src/importers/lxx.ts`, `corpus/grc-lxx`
- **Related:** [ADR 0003 · Never store reading text](../adr/0003-never-store-reading-text.md), [011 · Lectionary source](011-lectionary-source.md)

## Decision

The deuterocanonical corpus (`corpus/grc-lxx`) is **Swete's Septuagint** (H. B. Swete, _The Old Testament in Greek
according to the Septuagint_, Cambridge 1907–1912, public domain). The digital text comes from Eliran Wong's
[LXX-Swete-1930](https://github.com/eliranwong/LXX-Swete-1930), published under the **GNU GPL v3**.

- The importer pins the upstream commit `1d3efc3c63bd384a4f3f07ed37eef54b0d45ac33` and checks its archive sha256.
- The corpus is stored in the `lxx` versification.
- Rahlfs-Hanhart is under copyright and is not used as a source. One Rahlfs word list was consulted only to find
  verse boundaries; see [Verse numbering](#verse-numbering).

## Licence and provenance

- **What is licensed.** The upstream repository is GPL-3.0. Swete's printed edition is in the public domain.
  `corpus/grc-lxx/LICENSE.md` reproduces the GPL text verbatim, together with a modification notice, and
  `SOURCE.json` records `GPL-3.0-only`.
- **Where the digital text came from.** The upstream README says the text came from a BibleWorks module compiled by
  Pasquale Amicarelli. Amicarelli's own terms are not documented. People have asked the upstream about this since
  2023 (LXX-Swete-1930 issues #2, #4 and #5), and nobody has answered.

## Risk: low

- **Copyright in the text.** In the US, a faithful transcription of a public-domain text gains no new copyright
  (_Feist_). What risk remains is an EU database right, or the contract terms of the BibleWorks module, held by
  someone who apparently let the module be published.
- **GPL scope.** The GPL-3.0 data files sit in their own directory with the licence and a modification notice. That is
  aggregation under GPLv3 §5, so the repository's code does not become GPL.
- **Use.** Running the files in the evidence gate is use, which the GPL does not restrict.
- **Quotations.** Quoting single words on the site is de minimis, and the underlying Greek is in the public domain
  anyway.

## Obligations for downstream work

- **Conveying the files.** Anything that conveys these files must ship them under GPL-3.0 with the licence text. That
  includes a static API bundle, the mobile app and any downloadable corpus.
- **Credit.** The About page (L-059) credits the edition through `corpus:licences`.
- **Upstream changes.** If the upstream clarifies Amicarelli's terms, update `LICENSE.md` and this record.

## Fallbacks, if the owner withdraws acceptance

1. **eBible.org `grcbrent`.** This is Brenton's Greek Septuagint with the Apocrypha. It is marked as public domain and
   available as USFM, which makes it the strongest fallback without copyleft. Two catches:
   - Its Tobit is the B text, not the Sinaiticus text the NABRE translates.
   - Its verses are numbered in the Greek manuscripts' order (Sirach 30–36), so they would need the same remapping.
   - Its digitisation history is undocumented and would need checking.
2. **First1KGreek Swete** (OpenGreekAndLatin `tlg0527`, CC BY-SA 4.0). The licence is clear, but in these books whole
   passages are missing or misnumbered:
   - Wisdom 3:5–17 and chapter 15 are missing, and Wisdom 15–19 is numbered 16–20.
   - Daniel 12:5–13 and Bel 37–42 are missing.
   - About 60 verses of Sirach are missing.

   Those gaps would have to be patched before First1KGreek could be used.

3. **Avoid** Rahlfs-based sets: CCAT, eliranwong/LXX-Rahlfs-1935 and CenterBLC/LXX. Rahlfs-Hanhart is under copyright,
   and these sets come with user declarations or non-commercial licences.

## Verse numbering

- **Relocations.** Swete's numbering is mostly Rahlfs'. The importer moves two blocks into the `lxx` chapters:
  - Theodotion's Daniel 3:98–6:28;
  - Sirach 30:25–36:16, which the upstream gives in the Greek manuscripts' order.
- **Re-divided verses.** Where Swete's verse divisions shift whole verses against the `lxx` scheme, the importer
  re-divides the text using `LXX_VERSE_STARTS`. This covers Sirach 17, 20, 22, 23, 29, 33–38, 41, 42 and 51; Tobit
  5–8, 10, 11 and 13; Wisdom 17; Esther 9; Baruch 6; and Bel.
- **How the starts were found.** The starts were found by aligning Swete's words with the verse divisions of the
  eliranwong/LXX-Rahlfs-1935 word list, and checked by hand. Only verse positions are kept; no Rahlfs text is stored.
- **Test.** `lxx.corpus.test.ts` fails if the committed corpus drifts from the scheme. It checks the verse set of every
  chapter against `lxx`, plus a reviewed list of gaps, and checks anchor phrases.
- **Residual differences.** Elsewhere, Swete's and Rahlfs' divisions can still differ by a few words at a verse
  boundary, for example Sirach 3:26 and 2 Maccabees 4:20.
