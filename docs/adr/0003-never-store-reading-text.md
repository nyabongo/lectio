# ADR 0003: Never store reading text

- Status: accepted
- Date: 2026-10-04
- Issue: L-001

## Context

Lectionary translations used at Mass are copyrighted. Reproducing them would put licensing on the critical path of
the product. The value of Lectio is the commentary: who wrote the passage, to whom, why, and what the original
Hebrew, Greek or Latin says that English cannot.

## Decision

- The repository never stores English reading text: not in passage files, not in calendar files, not in fixtures.
  Readings appear only as references and as link-outs to a licensed or public-domain text (default: Douay-Rheims,
  decision L-201).
- Notes may quote single words or short phrases; the limits are configuration (`licenceGuard`, open decision L-210).
- Original-language corpora (Greek, Hebrew, Latin) are stored only from openly licensed editions, with their licence
  and attribution, because they are the ground truth for the evidence gate.
- The licence guard (gate 3) blocks long verbatim runs from English Bibles (via a hash-only shingle index that
  stores no text) and from cited commentaries.
- The passage schema rejects passage-level `text` or `verses` fields.

## Consequences

- Licensing becomes a managed risk instead of a blocker.
- Readers tap through to read the text; the site works even for passages without notes.
- Content PRs must never commit English Bible text; reviewers and gates check for it.
