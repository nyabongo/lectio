# 011 · Lectionary edition and reference-data source (L-211)

- **Status:** Accepted, with open questions. The owner decided on 2026-10-05 ([comment on #108](https://github.com/nyabongo/lectio/issues/108)).
- **Issue:** #108 (roadmap id L-211)
- **Unblocks:** L-016 (#15) and L-065 to L-069
- **Related:** [ADR 0004 · Passage keys and book codes](../adr/0004-passage-keys-and-book-codes.md) (#111)
- **Method:** Desk research only. Nothing was scraped. The one dataset read in bulk is a public Apache-2.0 GitHub repository, read through the GitHub API.

## Decision

**Lectionary data is provisional open data, which a person later verifies against the Kenyan book.**

1. **Target edition.** We are building towards the readings as used in Kenya. Those come from the Paulines Publications Africa *Lectionary* (Nairobi, 2020, chapel edition, 3 vols, ISBN 9966-60-148-3). Its readings are RSV-2CE and its structure is OLM 1981; it is not the US NABRE edition. The evidence is set out below; two items still need a physical copy (Q1).
2. **Primary machine source: the [Liturgical Calendar API](https://github.com/Liturgical-Calendar/LiturgicalCalendarAPI) lectionary corpus** (`jsondata/sourcedata/rite/roman/lectionary/*/en.json` and `decrees/lectionary/en.json`).
   - Licence: Apache-2.0.
   - Pinned by commit and registered as `litcal` in `calendar/lectionary/sources.json`.
   - Imported automatically; retrieval through git or the GitHub API is allowed.
3. **Gaps are filled from the OLM 1981 structure.** OLM 1981 is the *Ordo Lectionum Missae*, editio typica altera, LEV 1981.
   - Where LitCal is empty, the citation comes from OLM 1981. Examples: most OT weekdays, including weeks 24–25 of Year II, and St Matthew.
   - Each such entry's `source` names the OLM page and lectionary number.
   - Celebrations added after 1981 cite the Divine Worship decree that added their readings.
   - Kenya-proper celebrations cite the Kenyan *Daily Missal* (see Q5).
4. **Every entry carries `status: "provisional"`** until a person checks it against the Kenyan book. Hand entry from the Paulines 2020 *Lectionary* is the **verification path**, not the import path:
   - The verifier compares each entry with the book and records the Kenyan locator.
   - The verifier sets `status: "verified"`, or opens a dispute.
   - The completeness report counts provisional entries.
5. **Sources we do not use:** no scraping of usccb.org, Universalis or iBreviary, and no datasets derived from those sites by scraping.
6. **Versification follows ADR 0004:**
   - `ref` and passage keys use the **canonical NABRE ≈ original versification**: Hebrew psalm numbering, with superscriptions counted as verses.
   - `ref` has **no verse letters**.
   - The letters, and the edition's own numbering, live only in `printed`.

## Evidence for the edition

- The Paulines Africa *Daily Missal* (African Edition, 2012, reprinted 2018) uses "readings from the Revised Standard Version as authorised by the Southern African Catholic Bishops' Conference". It lists the calendars of Ghana, **Kenya**, Botswana, South Africa, eSwatini, Nigeria, Uganda and Sudan. Source: https://www.catholicbookshop.co.za/products/daily-missal-1
- The Paulines Africa *Lectionary* (2020) "is in harmony with the biblical text and Psalms found in the Daily missal". Source: https://shop.paulinesafrica.org/product/LECTIONARY
- The SACBC Communications Office wrote on 16 Jan 2012: "It is the RSV-2nd Catholic edition and has been approved for English Speaking Africa. It will be published by Paulines Africa." This is posted in the comments of https://bltnotjustasandwich.com/2012/01/15/things-get-weirder-with-english-catholic-lectionaries/
- Blog comments from 2011 are second-hand, not official. They say the conferences of South Africa, Nigeria, Ghana, **Kenya** and Uganda would adopt an RSV-2CE + revised Grail lectionary. Source: https://catholicbibles.blogspot.com/2011/04/what-to-do-with-rsv-2ce.html
- The Paulines Nairobi *Liturgy of the Hours* (2009) was approved by the Kenya conference on behalf of AMECEA and uses the (Revised) Grail psalter. Source: https://praytellblog.com/index.php/2014/08/05/book-review-kenyan-edition-of-the-liturgy-of-the-hours/
- **Conflicting evidence:**
  - Wikipedia lists the Jerusalem Bible for "Southern Africa": https://en.wikipedia.org/wiki/Ordo_Lectionum_Missae
  - Universalis serves a Kenya calendar with JB and Grail (1963) texts: https://universalis.com/africa.kenya/mass.htm
  - Universalis uses JB for every region it serves, so this is weak evidence.
- For the Kiswahili books, KCCB's *Misale ya Kiroma* and *Misale ya Kila Siku* (mandatory from Advent 2021) include the Kenya proper calendar. Source: https://www.aciafrica.org/news/4105/catholic-church-in-kenya-sets-date-to-phase-out-old-liturgical-book-for-priests

## Candidates compared

| Source | Coverage | Format | Licence / terms | Versification | Risks | Role |
|---|---|---|---|---|---|---|
| **LitCal lectionary corpus** ([repo](https://github.com/Liturgical-Calendar/LiturgicalCalendarAPI)) | Measured on `development` @ `00f4cf1a799a95a94f9e03b3b2e3e56e481d3118`. Filled leaves: Sundays A 363/369, Easter weekdays 167/168, OT weekdays I 24/816, OT weekdays II 263/816, sanctoral 418/877 | JSON keyed by celebration id | **Apache-2.0**. Automated retrieval allowed | US lectionary strings, which is NABRE: Hebrew psalm numbers, US verse letters. This matches ADR 0004's canonical versification | US edition, not Kenyan. Gaps. Maintainers document defects ([design note](https://github.com/Liturgical-Calendar/LiturgicalCalendarAPI/blob/development/docs/superpowers/specs/2026-09-03-lectionary-corpus-fixes-design.md)). The maintainers cite usccb.org pages as evidence when correcting data. Provenance risk: see Q6 | **Primary machine source** |
| **OLM 1981, editio typica altera** (LEV). Scan: https://archive.org/details/OLM1981 | Full General Roman lectionary as of 1981. No Kenya propers. No later additions | Print. A PDF scan exists | © LEV. Citations are facts. The scan's rights are not stated, so cite a print copy (Q4) | Nova Vulgata. Vulgate psalm numbers (Ps 144 = Heb 145) | Latin. Needs conversion to canonical | **Gap filler** (structure and lectionary numbers) |
| **DDW decrees** (also in LitCal `decrees/lectionary`) | Celebrations added after 1981 | Decrees | Official acts. Citations are facts | Varies by decree | Must be found per celebration | Gap filler for post-1981 additions |
| **Paulines Africa *Lectionary* (2020)** ([shop](https://shop.paulinesafrica.org/product/LECTIONARY)) and ***Daily Missal*** | Full year, Kenya calendar | Print | © Paulines / translation owners. Only citations (facts) are copied. Courtesy acknowledgement **to be requested** (Q2) | RSV-2CE readings, Grail-family psalms. Printed numbering to confirm (Q1) | Hand-checking effort | **Verification source** (`status: verified`). Kenya propers |
| **USCCB *Lectionary for Mass*** / bible.usccb.org | US lectionary | Print, web | © CCD. [Permissions](https://www.usccb.org/offices/new-american-bible/permissions). No scraping | NABRE | Owner excluded it | Not used |
| **Felix Just SJ tables** (https://catholic-resources.org/Lectionary/) | US Sundays and weekdays | HTML | Non-commercial with credit. Commercial use needs written permission ([terms](https://www.catholic-resources.org/Copyright.htm)) | NABRE | Non-commercial condition (Q3) | Human reference for disputes only |
| **Universalis** | Daily, Kenya calendar | Web, apps | No republication. Copying for private use only. Its only published terms found are on its [app privacy and terms page](https://universalis.com/n-ios-privacy.htm); no separate web terms of use were located | JB + Grail 1963 | Terms forbid reuse | Not used |
| **iBreviary** | Daily | Web, app | No terms located, so treated as all rights reserved | Varies | Unknown terms | Not used |
| **romcal** (https://github.com/romcal/romcal) | Calendar only | npm | MIT | n/a | No readings | Calendar only |
| **cpbjr/catholic-readings-api**, **westhong/catholic-daily-readings**, **rcolfin / andrewtryder catholic-mass-readings** | Partial / daily | JSON / libraries | MIT etc. Data scraped from USCCB or of undocumented provenance | NABRE | Scraped provenance | Rejected |
| **KCCB *Misale ya Kila Siku* (2021)** | Full year + Kenya propers | Print (Kiswahili) | © KCCB/Paulines. Facts only | To check | Needs a Kiswahili reader | Candidate second source for Kenya propers (Q5) |

### Citations as facts

A single citation is a fact, not a protected work. In the US see *Feist v. Rural* (1991); Kenya's Copyright Act 2001 protects compilations only for an original selection or arrangement. There is a residual risk that a whole lectionary table counts as a protected compilation, or in the EU attracts the sui generis database right (Directive 96/9/EC).

**Mitigation:**
- Store citations only, never text.
- Record `source` on every entry.
- Use open data (Apache-2.0) and print sources, not scraped websites.
- Ask KCCB's liturgy commission and Paulines Africa for a courtesy acknowledgement (Q2).

**No permission has been requested or obtained yet.**

## Entry shape

```json
{
  "slot": "gospel",
  "ref": "Mt 20:1-16",
  "printed": "Matthew 20:1-16a",
  "alternatives": [],
  "source": "litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 dominicale_et_festivum_A/en.json#OrdSunday25",
  "status": "provisional"
}
```

- **`ref`:** canonical versification per ADR 0004 (NABRE ≈ original, Hebrew psalm numbers), with **no verse letters**. It maps directly to the passage key: `Mt 20:1-16` → `MT.20.1-16`, and `Phil 1:20-24, 27` → `PHIL.1.20-24_1.27`.
- **`printed`:** optional. It holds the citation exactly as the cited source prints it, keeping that source's letters, numbering and book names. Examples are `Philippians 1:20c-24, 27a` for LitCal and `Ps 144, 2-3. 8-9. 17-18` for OLM. When a verifier checks the entry against the Kenyan book, they replace `printed` with the Kenyan print and update `source` to the Kenyan locator.
- **`status`:** `provisional`, `verified` or `disputed`.

## The `source` field format

```
<source-id>[@<revision>] <locator>
```

The rules for each part:

- **`source-id`** matches `[a-z0-9-]+` and must exist in `calendar/lectionary/sources.json`. That registry records:
  - the bibliography
  - translation, versification and psalm-numbering convention
  - licence / terms
  - permission status (`none-needed` | `to-request` | `requested <date>` | `granted <date> <ref>`)
  - whether automated retrieval is allowed
  - who holds the physical copy
- **`@<revision>`** is required for versioned digital sources (a full 40-character git SHA) and forbidden for print sources.
- **The locator** has a grammar for each id:

| id | locator regex | example |
|---|---|---|
| `litcal` | `[a-z_]+(/[a-z]{2})?\.json#[A-Za-z0-9]+(\.[a-z]+)?` | `litcal@00f4cf1a799a95a94f9e03b3b2e3e56e481d3118 dominicale_et_festivum_A/en.json#OrdSunday25` |
| `olm-1981` | `p[0-9]+#[0-9]+` | `olm-1981 p97#133` |
| `ddw-decree` | `[0-9]{4}-[0-9]{2}-[0-9]{2}#.+` (date and Prot. N.) | `ddw-decree 2016-06-03#Prot.NNN/16` |
| `ke-lect-2020` | `v[1-3]:p[0-9]+#[0-9]+` | `ke-lect-2020 v3:p412#133` |
| `ke-dm-2018` | `p[0-9]+` | `ke-dm-2018 p1534` |

Full line regex: `^(?<id>[a-z0-9-]+)(?:@(?<rev>[0-9a-f]{40}))? (?<locator>\S+)$`.

Page numbers and the Prot. N. in the examples are illustrative. The `#<n>` after a page is the OLM 1981 lectionary number. Whether the Kenyan print uses OLM numbering or US renumbering must be confirmed (Q1).

## Versification and conversion

Canonical versification is **NABRE ≈ original**, per ADR 0004. The import from LitCal mostly needs letters stripped, because LitCal is already NABRE. Gap-fill from OLM, and later verification against the RSV-2CE Kenyan book, must convert to canonical. `lectionary:crosscheck` compares **canonical, letter-free refs only**, so differences in letters are never disputes.

Conversions to handle (the tables live in L-006):

- **Psalms.** Vulgate and LXX numbers differ from Hebrew for Ps 9–147. Ps 9/10, 114/115, 116 and 147 split or merge depending on the verses cited. Verse numbers: Hebrew and NABRE count superscriptions as verses; the RSV does not (RSV Ps 51:1-2 = NABRE Ps 51:3-4). The Kenyan psalter's numbering is still to be confirmed (Q1).
- **Joel:** Joel 3:1-5 (NABRE/NV) = RSV 2:28-32.
- **Malachi:** Mal 3:19-24 (NABRE/NV) = RSV 4:1-6.
- **Esther:** NABRE uses chapters with lettered Greek additions (A–F, e.g. `Est C:12, 14-16, 23-25`). The Nova Vulgata uses `4:17n…` and the RSV-CE uses chapters 11–16 (e.g. `14:1-19`). All map to the NABRE form.
- **Sirach:** some chapters number verses differently in the Vulgate/NV and Greek-based (RSV-CE) texts compared with NABRE. Check entry by entry.
- **Tobit:** NV (Vulgate tradition), RSV-CE (Greek) and NABRE differ in places. Check entry by entry.
- **Also:** Hos 14:2-10 = RSV 14:1-9; Jonah 2:1 = RSV 1:17; 1 Kgs 5:1-14 = RSV 4:21-34; Latin book names.
- **Verse letters** (a/b/c) depend on how each translation divides sentences. They are dropped from `ref` and kept only in `printed`.
- **Long and short forms, and "or" options,** are separate refs in `alternatives`.

## Open questions for the owner

1. **Physical copy.** From the Paulines 2020 *Lectionary* or *Daily Missal*, confirm:
   - the translation (RSV-2CE?)
   - the psalter (Grail 1963 or Revised Grail?)
   - the approval decree
   - psalm numbering (Vulgate, Hebrew, or both)
   - verse numbering (RSV or NV)
   - whether its lectionary numbers follow OLM 1981 or a local renumbering
2. **Courtesy letter.** May we write to the KCCB Commission for Liturgy and Paulines Africa (support@paulinesafrica.org)? Nothing has been sent.
3. **Commercial status.** Is Lectio non-commercial? This decides whether Felix Just's tables may be consulted for disputes.
4. **OLM 1981 copy.** Do you approve buying a print copy (LEV) as the citable gap-fill source?
5. **Kenya propers.** Kiswahili *Misale ya Kila Siku* as a second source, or the Kenyan *Daily Missal* alone with owner review?
6. **LitCal provenance.** LitCal's English citations are US-lectionary data, and its maintainers verify corrections against usccb.org pages. It is not a USCCB scrape: it is a curated Apache-2.0 corpus, and citations are facts. Please confirm that this satisfies the "no datasets derived from usccb.org" rule.

## Downstream changes

**L-016 (#15) must update its issue text before it starts:**
1. Add `calendar/lectionary/sources.json` (the registry above) and `calendar/lectionary/import/litcal` (or the equivalent import script) to **Touches**.
2. **Entry shape:** `{ slot, ref, printed?, alternatives?, source, status }`.
   - `ref` follows ADR 0004 (NABRE canonical, no letters).
   - `status` is `provisional | verified | disputed`.
3. **`lectionary:check`** must:
   - parse every `ref` (L-005)
   - reject verse letters in `ref`
   - validate `source` against the full-line regex and the locator regex for its id from the registry
   - require `status`
4. **Seed block:**
   - Import the two Sundays (25th and 26th, Year A) from LitCal at a pinned SHA.
   - Fill OT weeks 24–25 Year II weekdays and St Matthew from OLM 1981.
   - Mark every entry `provisional`.
5. **Cross-check.**
   - `lectionary:crosscheck` compares canonical, letter-free refs, after conversion from each source's convention. The conversions are Vulgate/LXX psalms, Joel, Malachi, Esther, Sirach and Tobit.
   - The "second independent source" for the seed block is OLM 1981 for the entries imported from LitCal, and LitCal wherever it has data for the OLM-filled entries. Entries that neither covers are listed as "single-source" in the disputes file.
6. **Acceptance criterion for 2026-09-20.** Restate as: resolves to refs `Is 55:6-9; Ps 145:2-3, 8-9, 17-18; Phil 1:20-24, 27; Mt 20:1-16` (keys as in L-017), all `status: "provisional"`. The lettered strings belong in `printed`.

**L-065 to L-069:** import from LitCal first, then gap-fill from OLM 1981, DDW decrees, or the Kenyan *Daily Missal* for Kenya propers. Every entry is `provisional`. The acceptance criterion "second independent source" reads as above.

**L-070:** the completeness report also counts `provisional` entries. They do not count as missing.

**Issue #108:** Touches and AC already name `docs/decisions/011-lectionary-source.md`, which is this file.
