# ADR 0002: Content keyed by passage

- Status: accepted
- Date: 2026-10-04
- Issue: L-001

## Context

The lectionary repeats: Sundays on a three-year cycle (A/B/C), weekdays on a two-year cycle (I/II), and saints'
days every year. A note researched for one date is valid every time the same passage is read. Research and
verification are the expensive part of the product.

## Decision

- Notes are stored per passage: `passages/<key>.json`, one file per passage key (ADR 0004), holding the context
  note, translation notes, claims, sources, provenance and review block.
- Dates resolve to passages through computed calendar files, `calendar/<year>.json` (date → celebrations, season,
  colour, readings by reference and passage key, link-out URLs).
- Published notes are never regenerated automatically; a change is a new pull request through the same gates.

## Consequences

- Each verified note is a permanent asset reused in every future cycle, so the cost of the library is bounded.
- Permanent links (`/<date>/<slot>`) keep working years later.
- The research planner only has to find passage keys in the upcoming window that have no file yet.
- Two readings that differ only in verse range are different passages with different files; overlapping ranges are
  not merged.
