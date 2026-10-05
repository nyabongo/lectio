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
- Canonical versification is NABRE ≈ original (Hebrew psalm numbering, superscriptions included). Mapping to Vulgate
  or LXX numbering happens at the edges (corpus lookups, Douay-Rheims link-outs), L-006.

## Consequences

- Keys use only `[A-Z0-9._-]`, so they are safe file names and URL segments.
- Dropping sub-verse letters means `Mt 20:1-16a` and `Mt 20:1-16` share a note; the full reference with letters is
  kept in the passage file's `ref`.
- `fromKey(toKey(ref))` round-trips (property-tested in L-005).
