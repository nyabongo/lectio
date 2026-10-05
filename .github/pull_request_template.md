<!-- Title: `L-NNN: <issue title>` · Branch: `L-NNN/short-slug` -->

Closes #

## Summary

<!-- What changed and why, in a few bullets. -->

## Acceptance criteria

<!-- Copy the issue's checklist; tick each item or explain why it is not met. -->

- [ ]

## Checklist

- [ ] Touches only the paths listed on the issue (shared files are named there explicitly)
- [ ] `npm run verify` passes locally (lint, format, typecheck, tests with coverage, coverage floor, required checks)
- [ ] Unit coverage ≥ 96% for lines, branches, functions and statements; no threshold lowered
- [ ] Every external call goes through a provider interface with a fake; unit tests are offline
- [ ] No logic in `scripts/` (thin wrappers only); no English Bible text committed
- [ ] New required-check workflows: own file, `workflow_dispatch`, no trigger-level `paths:`, registered in `.github/required-checks/`

## Coverage

<!-- Paste the "Coverage summary" table from `npm run test:coverage` or the unit-coverage job summary. -->
