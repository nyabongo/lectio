# ADR 0004: Passage keys and book codes

- Status: accepted
- Date: 2026-10-04
- Issue: L-001 (implemented by L-005)

## Context

References arrive in lectionary style (`Phil 1:20c-24, 27a`, `Ps 145:2-3, 8-9, 17-18`) and must map to one stable,
filename-safe key per passage, usable as a file name on Windows, macOS and Linux and in URLs.

## Decision

- **Book codes** are the upper-cased NABRE abbreviations for the 73-book Catholic canon: `GN`, `EX`, …, `PS`, `PRV`,
  `ECCL`, `IS`, …, `MT`, `MK`, `LK`, `JN`, `ACTS`, `ROM`, `1COR`, `PHIL`, …, `RV`. The book table also records
  English names, aliases, OSIS and USFM ids and Douay-Rheims numbering.
- **Passage key** = book code once, then segments joined by `_`, each segment carrying its chapter, verse ranges
  with `-`, sub-verse letters dropped:
  - `Mt 20:1-16a` → `MT.20.1-16`
  - `Phil 1:20c-24, 27a` → `PHIL.1.20-24_1.27`
  - `Ps 145:2-3, 8-9, 17-18` → `PS.145.2-3_145.8-9_145.17-18`
  - `Eccl 11:9—12:8` → `ECCL.11.9-12.8`
- **Greek Esther** (added by L-049): the NABRE prints the Greek additions to Esther as lettered chapters `A`–`F`, and
  only an `EST` key may name a chapter by its letter, in any chapter position:
  - `Est C:12, 14-16, 23-25` → `EST.C.12_C.14-16_C.23-25`
  - `Est C:30—D:2` → `EST.C.30-D.2`; `Est A-B` → `EST.A-B`
  - A range never mixes a lettered and a numbered chapter (`EST.4.17-C.2` is refused); cite them as separate
    segments (`EST.4.17_C.1-2`).
  - Verses are always numbers, so after a verse a lone end is a verse (`EST.1.2-C` is refused).
  - Internally a lettered chapter is a stand-in number (A = 101, … F = 106, `packages/refs/src/greek-esther.ts`). A
    key, a reference or an error message never shows it: `EST.103.12` and `Est 103:12` are refused.
  - The letters are the NABRE's, not Rahlfs' sub-verses (`Est C:12` is Rahlfs 4:17k) or the Vulgate's 10:4–16:24;
    mapping to those happens at the edges like any other versification.
  - Sorting keys by chapter number puts the additions after chapter 10. In reading order they sit inside the Hebrew
    text (A, 1, 2, 3:1-13, B, …); use `comparePoints` from `@lectio/refs` to sort passages that way.
- Canonical versification is NABRE ≈ original (Hebrew psalm numbering, superscriptions included). Mapping to Vulgate
  or LXX numbering happens at the edges (corpus lookups, Douay-Rheims link-outs), L-006.

## Consequences

- Keys use only `[A-Z0-9._-]`, so they are safe file names and URL segments (the Esther letters included).
- Dropping sub-verse letters means `Mt 20:1-16a` and `Mt 20:1-16` share a note; the full reference with letters is
  kept in the passage file's `ref`.
- `fromKey(toKey(ref))` round-trips (property-tested in L-005).
