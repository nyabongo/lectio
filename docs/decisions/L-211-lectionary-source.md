# L-211 · Lectionary edition and reference-data source

- **Status:** Proposed. The owner must confirm before L-016 starts (see [Open questions](#open-questions-for-the-owner)).
- **Issue:** #108 (roadmap id L-211)
- **Date:** 2026-10-04
- **Unblocks:** L-016 (format, resolver, seed week) and L-065 to L-069 (full-year blocks)
- **Method:** Desk research only. Nothing was scraped. The only data read in bulk was a public, Apache-2.0 GitHub repository, read through the GitHub API.

## Recommendation

1. **Edition.** Kenya's English Mass readings come from the **Lectionary published by Paulines Publications Africa, Nairobi**. The current printing is the 2020 three-volume chapel edition, ISBN 9966-60-148-3. It is textually "in harmony with" the Paulines *Daily Missal* (African Edition, 2012, reprinted 2018), which lists the Kenya calendar. The readings use the **Revised Standard Version, Second Catholic Edition (RSV-2CE)**, which was approved for English-speaking Africa. The structure follows the **Ordo Lectionum Missae, editio typica altera (OLM 1981)**. This is not the US NABRE lectionary, and it is probably not the Jerusalem Bible either (see the evidence below). One fact is still unconfirmed: the exact psalter, which is either the Grail (1963) or the Revised Grail. The owner should check a physical copy (Q1).
2. **Primary source.** Enter the citations by hand from the Kenyan edition named above. Each entry records volume, page and lectionary number. Until a copy of the 2020 Lectionary is to hand, the Paulines *Daily Missal* (African Edition) can be used, because it carries the same text and citations.
3. **Cross-check source (100%).** Use the **OLM 1981 Latin typical edition** (Libreria Editrice Vaticana), entered by hand by a different person from the one who entered the primary data. It covers every block, it is the authority the Kenyan edition is built on, and it was printed separately from the Kenyan edition. Any disagreement is either a transcription error or a genuine local adaptation, and the owner should see both.
4. **Optional automated pre-check.** Before the human cross-check, compare each block against the **Liturgical Calendar API lectionary corpus** (Apache-2.0, machine-readable JSON, citations derived from the US lectionary), pinned to a commit. It is cheap and catches gross errors. It is not the cross-check of record, because it is US-derived and incomplete: it has nothing for OT weeks 24–25 or for St Matthew, for example.
5. **No openly licensed dataset of the Kenyan (RSV-2CE) citations exists.** Every open dataset found is either US-derived or scraped from usccb.org, and the second kind is rejected.
6. **Passage keys use one canonical versification**, the in-repo original-language corpus (Hebrew psalm numbers and verse numbers). The edition's printed citation is stored next to the key, verbatim, as a fact. See [Versification](#numbering-and-versification-implications-for-passage-keys).

## Evidence for the edition

- The Paulines Africa *Daily Missal* (African Edition) uses "readings from the Revised Standard Version as authorised by the Southern African Catholic Bishops' Conference" and includes the calendars of Ghana, **Kenya**, Botswana, South Africa, eSwatini, Nigeria, Uganda and Sudan. Source: https://www.catholicbookshop.co.za/products/daily-missal-1
- The Paulines Africa *Lectionary* (2020, 3 vols, chapel edition, English, ISBN 9966-60-148-3) states that its text "is in harmony with the biblical text and Psalms found in the Daily missal". Source: https://shop.paulinesafrica.org/product/LECTIONARY
- On 16 Jan 2012 the SACBC Communications Office said of the new lectionary: "It is the RSV-2nd Catholic edition and has been approved for English Speaking Africa. It will be published by Paulines Africa." This appears as a correction in the comments of https://bltnotjustasandwich.com/2012/01/15/things-get-weirder-with-english-catholic-lectionaries/
- Comments from 2011 (second-hand, not official) say the conferences of South Africa, Nigeria, Ghana, **Kenya** and Uganda would adopt a lectionary combining the RSV-2CE with the revised Grail psalms. Another commenter mentions a Pauline Sisters notice to the same effect. Source: https://catholicbibles.blogspot.com/2011/04/what-to-do-with-rsv-2ce.html
- The Paulines Nairobi *Liturgy of the Hours* (2009) was approved by the Kenya conference on behalf of AMECEA, for all English-speaking Roman Rite Catholics of Africa, and uses the (Revised) Grail psalter from Conception Abbey. This makes the Revised Grail the likely psalter in the lectionary too. Source: https://praytellblog.com/index.php/2014/08/05/book-review-kenyan-edition-of-the-liturgy-of-the-hours/
- **Conflicting evidence:** Wikipedia lists the Jerusalem Bible for "Southern Africa" (https://en.wikipedia.org/wiki/Ordo_Lectionum_Missae), and Universalis serves a Kenya calendar with JB and Grail (1963) texts (https://universalis.com/africa.kenya/mass.htm). Universalis uses JB for every region it serves, so this does not show that Kenyan parishes use JB. Older JB lectionaries may still be in use in some places (Q1).
- For the Kiswahili books, KCCB approved the *Misale ya Kiroma* and *Misale ya Kila Siku* (mandatory from Advent 2021), which include the Kenya proper calendar. Source: https://www.aciafrica.org/news/4105/catholic-church-in-kenya-sets-date-to-phase-out-old-liturgical-book-for-priests

## Candidates compared

| Source | Coverage | Format | Licence / terms | Versification | Risks | Verdict |
|---|---|---|---|---|---|---|
| **Paulines Africa *Lectionary* (2020, 3 vols)** ([shop](https://shop.paulinesafrica.org/product/LECTIONARY)) and ***Daily Missal*, African Ed.** ([listing](https://www.catholicbookshop.co.za/products/daily-missal-1)) | Full year, Kenya calendar included | Print | © Paulines / translation owners. We copy **citations only** (facts), never text. Permission not strictly needed for facts, but requested as a courtesy (Q2) | RSV-2CE for readings; Grail or Revised Grail psalms. Psalm numbering in print to be confirmed (Q1) | Edition not yet confirmed from a physical copy. Hand entry errors (hence the cross-check) | **Primary** |
| **OLM 1981, editio typica altera** (LEV). Scan: https://archive.org/details/OLM1981 | Full General Roman lectionary as of 1981. No Kenya propers. No celebrations added after 1981 | Print. A PDF scan exists | © LEV. Citations are facts. The archive.org scan has no stated rights, so use a purchased print copy as the citable source and treat the scan as a convenience for reading only (Q4) | Nova Vulgata versification. Psalms printed with **Vulgate** numbers (Ps 144 = Heb 145) | Latin. Needs book-name and psalm-number mapping. Post-1981 additions (e.g. St Mary Magdalene feast 2016, Mary Mother of the Church 2018) must come from DDW decrees | **Cross-check of record** |
| **Liturgical Calendar API lectionary corpus** ([repo](https://github.com/Liturgical-Calendar/LiturgicalCalendarAPI), `jsondata/sourcedata/rite/roman/lectionary/*/en.json`, plus `decrees/lectionary`) | Measured on `development` @ `00f4cf1`: Sundays A 363/369 leaves filled, Easter weekdays 167/168, OT weekdays I 24/816, OT weekdays II 263/816, sanctoral 418/877 | JSON keyed by celebration id | **Apache-2.0** (repo licence). Automated retrieval through git/GitHub API is fine | US lectionary (NAB) strings, Hebrew psalm numbers, US verse letters (e.g. `Philippians 1:20c-24, 27a`) | US-derived, so it is not the Kenyan edition. Gaps. Own maintainers document defects (vigil/day duplication, Latin copied into `nl`): [design note](https://github.com/Liturgical-Calendar/LiturgicalCalendarAPI/blob/development/docs/superpowers/specs/2026-09-03-lectionary-corpus-fixes-design.md) | **Optional automated pre-check**, pinned by SHA |
| **USCCB *Lectionary for Mass*** and bible.usccb.org | Full US lectionary | Print and web | © CCD. Permission policy covers text reprints: https://www.usccb.org/offices/new-american-bible/permissions. Web pages must not be scraped | NABRE | US adaptations and versification. Not the Kenyan edition | Rejected as a data source (indirectly represented via LitCal) |
| **Felix Just SJ, catholic-resources.org tables** (https://catholic-resources.org/Lectionary/) | Sundays A/B/C, weekdays I/II, feasts (US 1998/2002) | HTML tables | Reuse allowed with credit for non-commercial use only. Commercial use needs written permission: https://www.catholic-resources.org/Copyright.htm | US (NAB) | Non-commercial condition (Q3). US edition | Human reference for disputes only |
| **Universalis** (Kenya calendar) | Daily, Kenya calendar | Web, apps | No republication. Copying for private use only: https://universalis.com/n-ios-privacy.htm | JB + Grail 1963, `Psalm 79(80)` style | Terms forbid reuse. Translation probably not Kenya's | Rejected (may be used for human spot-checks of which celebration applies) |
| **iBreviary** | Daily | Web, app | No terms of use located, so treated as all rights reserved | Varies by language | Unknown terms | Rejected |
| **romcal** (https://github.com/romcal/romcal) | Calendar only | npm / JSON | MIT | n/a | **No readings** | Calendar only (already chosen for L-0xx calendar work) |
| **cpbjr/catholic-readings-api** (https://github.com/cpbjr/catholic-readings-api) | 2025 partial (43 daily readings), 2026 | JSON | MIT claimed, but provenance undocumented (USCCB listed as source) | US | Unknown provenance, partial | Rejected |
| **westhong/catholic-daily-readings** (https://github.com/westhong/catholic-daily-readings) | Daily | JSON, citation-only | MIT, but data comes from a USCCB scraper (`scrape_usccb_calendar.py`) | US | Scraped provenance | Rejected |
| **rcolfin / andrewtryder catholic-mass-readings** | Daily | Libraries | Code licences only. They fetch usccb.org pages | US | Scrapers | Rejected |
| **KCCB Kiswahili *Misale ya Kila Siku* (2021)** | Full year + Kenya propers | Print | © KCCB/Paulines. Facts only | Kiswahili Bible (versification to check) | Different language. Needs a Kiswahili reader | Candidate cross-check for Kenya propers (Q5) |

### Citations as facts

A single citation ("Is 55:6-9") is a fact and is not protected by copyright. In the US see *Feist v. Rural* (1991). Kenya's Copyright Act 2001 likewise protects compilations only for an original selection or arrangement. Two residual risks remain:

1. A whole lectionary *table* (the selection of which pericope goes with which day) could be argued to be a protected compilation. In the EU it could also attract the sui generis database right (Directive 96/9/EC).
2. Some publishers' terms of use forbid reuse regardless of copyright.

**Mitigation:**

- Compile by hand from print, not from websites.
- Store only citations, never text.
- Record a `source` on every entry.
- Write to KCCB's liturgy commission and Paulines Africa: confirm the edition, and ask them to acknowledge that Lectio reproduces citations, without text, with attribution (Q2).

Ordo citations are reproduced in parish bulletins, diocesan ordos and many apps, so the practical risk is low. **No permission has been requested or obtained yet.** Sending that letter needs the owner.

## Chosen sources

| Role | Source id (proposed) | Bibliographic record |
|---|---|---|
| Primary | `ke-lect-2020` | *Lectionary* (chapel edition, 3 vols). Nairobi: Paulines Publications Africa, 2020. ISBN 9966-60-148-3. RSV-2CE readings. Locator: volume, page, lectionary number |
| Primary (interim) | `ke-dm-2018` | *The Daily Missal*, African Edition. Nairobi: Paulines Publications Africa, 2012, repr. 2018. Locator: page |
| Cross-check | `olm-1981` | *Ordo Lectionum Missae*, editio typica altera. Vatican City: Libreria Editrice Vaticana, 1981. Locator: page and pericope number |
| Cross-check (post-1981 additions) | `ddw-decree-<yyyy-mm-dd>` | The Dicastery/Congregation for Divine Worship decree that added the celebration's readings. Locator: Prot. N. |
| Automated pre-check | `litcal@<sha>` | Liturgical Calendar API, Apache-2.0. Locator: `<section>/en.json#<key>[.<mass>]` |

## The `source` field format (for L-016)

`source` is a string:

```
<source-id>[@<revision>] <locator>
```

- `source-id` must exist in a new registry, `calendar/lectionary/sources.json`. Each registry record holds: the bibliographic record, edition, translation, versification and psalm-numbering convention, licence/terms, permission status (`none-needed` | `requested <date>` | `granted <date> <ref>`), whether automated retrieval is allowed, and who holds the physical copy.
- `@revision` is required for versioned digital sources (a git SHA) and forbidden for print.
- The locator grammar depends on the source: `v<vol>:p<page>#<lectionary-no>` for `ke-lect-2020`, `p<page>#<no>` for `olm-1981`, `p<page>` for `ke-dm-2018`.
- `lectionary:check` validates the id against the registry and the locator against the regex for that id.

Examples:

```
ke-lect-2020 v3:p412#133
olm-1981 p.97#133
litcal@00f4cf1 dominicale_et_festivum_A/en.json#OrdSunday25
```

The lectionary number (the OLM 1981 pericope number) is the stable cross-edition locator. Page and volume make each entry findable in the book.

## Numbering and versification implications for passage keys

The three books involved number some passages differently:

| Book | Basis | Example |
|---|---|---|
| OLM 1981 | Nova Vulgata versification, Vulgate psalm numbers | Ps 144 |
| US lectionary | NABRE versification, Hebrew psalm numbers | Ps 145 |
| Kenyan edition | RSV-2CE readings with Grail-family psalms; numbering to confirm | Possibly `Ps 144(145)` or `Ps 145` |

The cases that matter:

- **Psalm numbers.** Vulgate and Hebrew numbering differ for Ps 9–147. Ps 9/10, 114/115, 116 and 147 split or merge depending on the verses cited (mapping table in the LitCal design note above).
- **Psalm verse numbers.** The Hebrew text, the Nova Vulgata, NABRE and the Grail psalms count a psalm's title as verse 1 (US Ash Wednesday: Ps 51:3-4…). The RSV does not (RSV Ps 51:1-2). Lectionaries normally keep the Hebrew-style numbers even when the readings are RSV. Confirm against the Kenyan print (Q1).
- **Chapter shifts between Hebrew/NV and RSV:**
  - Mal 3:19-24 = RSV Mal 4:1-6 (33rd Sunday C)
  - Joel 3:1-5 = RSV Joel 2:28-32 (Pentecost Vigil)
  - Hos 14:2-10 = RSV 14:1-9
  - Jonah 2:1 = RSV 1:17
  - 1 Kgs 5:1-14 = RSV 4:21-34
- **Greek additions:**
  - Esther: NV `Est 4:17n…` versus RSV-CE `Est 14:1-19` (Lent wk 1 Thu).
  - Daniel 3 and 13 sit in the same place in NV and RSV-CE but must be mapped to the LXX corpus (L-071).
- **Sirach and Tobit:** some chapters number differently between the NV and RSV-CE (Greek) textual bases. Check entry by entry.
- **Verse letters (a/b/c)** depend on how each translation divides sentences, so `Phil 1:20c-24, 27a` may be lettered differently in RSV-2CE. Long and short forms (`Mt 1:1-25 | 1:18-25`) and "or" alternatives are separate refs.

**Decision for keys:**

1. Passage keys (`passages/<KEY>.json`, e.g. `PS.145.2-3_145.8-9_145.17-18`, `PHIL.1.20-24_1.27`, as L-017 already assumes) use the **in-repo original-language corpus versification**: MT for the Hebrew OT (Hebrew psalm numbers, titles counted as verses), the Greek NT, and LXX for deuterocanonical and Greek-addition passages. Mapping goes through the L-006 versification tables. Verse letters are dropped from keys.
2. Each lectionary entry stores three things:
   - `ref`: canonical, same versification, keeps letters
   - `printed`: the citation exactly as printed in the source edition, a fact
   - `source`

   The edition's own numbering is never lost, and keys stay stable whatever the printed convention.
3. `lectionary:crosscheck` compares **canonical** refs after mapping each source's convention: Vulgate to Hebrew psalms, NV/RSV chapter shifts, Latin book names. It classifies differences as `book/chapter/verse` (dispute), `letters-only` (minor, listed) or `alternative-set` (dispute).

## Open questions for the owner

1. **Confirm the edition from a physical copy** of the Paulines *Lectionary* (2020) or *Daily Missal*. Check:
   - translation (RSV-2CE?)
   - psalter (Grail 1963 or Revised Grail?)
   - approval decree (KCCB/AMECEA, confirmatio of the Apostolic See)
   - psalm numbering in print (Vulgate, Hebrew, or both)
   - whether verse numbers follow the RSV or the NV

   Are JB lectionaries still in use in any Kenyan diocese?
2. **Permission/acknowledgement.** May we write to the KCCB Commission for Liturgy and Paulines Publications Africa (support@paulinesafrica.org) to confirm the edition and to say that Lectio reproduces citations only, with attribution? Nothing has been sent.
3. **Is Lectio non-commercial?** This decides whether Felix Just's tables may be consulted and cited without written permission.
4. **OLM 1981 copy.** Do you approve buying a print copy (LEV) as the citable cross-check source? The archive.org scan's rights are unclear.
5. **Kenya propers (L-069).** OLM 1981 and LitCal do not cover Kenya-proper celebrations. Should the KCCB Kiswahili *Misale ya Kila Siku* be the second source for those, which needs a Kiswahili reader? Or do you accept a single source plus owner review for them?
6. **File name.** Issue #108's acceptance criteria name `docs/decisions/011-lectionary-source.md`. This record is at `docs/decisions/L-211-lectionary-source.md` as instructed. Rename if the numbered convention is preferred.

## Consequences for L-016 (changes to its current text)

- **Add `calendar/lectionary/sources.json`** (the source registry) and validate `source` against it. Free-text sources are not allowed.
- **Entry shape** becomes `{ slot, ref, printed, alternatives?, source }`. Here `ref` is canonical (corpus versification) and `printed` is verbatim from the edition.
- **Acceptance criterion for 2026-09-20.** State it in canonical refs (`Is 55:6-9; Ps 145:2-3, 8-9, 17-18; Phil 1:20c-24, 27a; Mt 20:1-16a`, keys as in L-017), checked against `ke-lect-2020` or `ke-dm-2018`. The current strings are the US/LitCal form. The Kenyan print may read `Ps 144(145)` or letter verses differently, and that is recorded in `printed`, not treated as a failure.
- **Seed cross-check.** Use `olm-1981` for every seed entry. LitCal covers only the two Sundays in the seed week: it has nothing for OT weeks 24–25 of Year II, nor for St Matthew. LitCal may run as an extra automated pre-check.
- **`lectionary:crosscheck`** must normalise psalm numbering (Vulgate↔Hebrew, including the split psalms) and the NV/RSV chapter shifts before comparing, and must report letter-only differences separately.
