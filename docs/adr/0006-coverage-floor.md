# ADR 0006: 96% unit-coverage floor

- Status: accepted
- Date: 2026-10-04
- Issue: L-001

## Context

Most code in this repository is written by AI agents working in parallel, and the content gates decide what is
published about Scripture. Untested code paths are where silent errors hide. A floor enforced from the first commit
is far cheaper than one retrofitted later.

## Decision

- Unit coverage must be **≥ 96% for lines, branches, functions and statements**, globally and per source glob, on
  every pull request. Vitest's v8 provider measures every file under `packages/*/src`, `apps/*/src/lib` and
  `apps/web/src/sw`, whether or not a test imports it; only `*.d.ts`, `*.test.*`, `fixtures/` and `__generated__/`
  are excluded.
- `npm run test:coverage` (CI job `unit-coverage`) fails below the thresholds.
- `npm run coverage:floor` (CI job `coverage-floor`) fails if a threshold in `vitest.config.ts` or in
  `apps/mobile/tool/check_coverage.dart` is set below 96, or if `coverage.include` stops covering package sources or
  the service worker. The logic is `packages/shared/src/coverage-floor.ts`, itself covered.
- CODEOWNERS routes `vitest.config.ts`, `.github/`, the floor script and its logic, and the Dart check to the owner.
- The Flutter app enforces Dart line coverage ≥ 96% in its own workflow (L-100).
- Repo-level suites in `tests/*` (content gates over real content, docs checks) are excluded from coverage.

## Consequences

- Every package keeps logic in small, testable functions; CLIs and `scripts/` are thin wrappers.
- Coverage can never drift down one PR at a time; lowering the floor requires an owner-approved change to this ADR.
- 96% rather than 100% leaves room for genuinely unreachable defensive code without encouraging coverage theatre.
