# AGENTS.md

Condensed rules for AI agents working on Lectio. The full version is [CONTRIBUTING.md](CONTRIBUTING.md); the
architecture is in [docs/architecture.md](docs/architecture.md).

## Workflow

1. Read the issue (`gh issue view <n> --repo nyabongo/lectio`); its body is the spec. Implement all of it.
2. Branch `L-NNN/short-slug` from `main`, in your own worktree.
3. Touch only the paths in the issue's `Touches` line. `package.json`, `package-lock.json`, workflows,
   `apps/web/astro.config.mjs` and i18n catalogs only when listed there.
4. `npm run verify` must pass before you push.
5. PR title `L-NNN: <title>`; body has `Closes #<n>`, a summary, the acceptance-criteria checklist (each ticked or
   explained) and the coverage table.
6. Never merge, never change repo settings or branch protection.

## Hard rules

- Unit coverage ≥ 96% for lines, branches, functions and statements. Never lower a threshold or narrow
  `coverage.include` (`npm run coverage:floor` enforces it).
- Every external call goes through a provider interface with a fake (`@lectio/providers`). Unit tests are offline:
  an msw guard fails unmocked requests. Use `server.use(...)` from `@lectio/shared/test-server`.
- No logic in `scripts/`; wrappers call tested package functions.
- Never commit English Bible text (commentary, references and link-outs only).
- Required-check workflows: own file, `workflow_dispatch`, no trigger-level `paths:`, registered in
  `.github/required-checks/`; the changes step diffs against origin/main when the event is not a pull_request.
- Pre-registered scripts (`tsx ../../scripts/run-planned.mjs L-NNN <target>`) start working when you create the
  target file at that exact path. Do not edit manifests to rename them.
- npm is pinned (`packageManager` in package.json, npm 10.9.9); regenerate the lockfile only with that version.
- Lockfile conflict: rebase, `git checkout origin/main -- package-lock.json`, `npm install`, commit.
- Flutter: iterate through CI on a draft PR.
- After changing an i18n catalog (`apps/web/src/i18n/**` or `apps/mobile/lib/l10n/catalog/**`), run
  `npm run l10n:sync` and commit the regenerated `apps/mobile/lib/l10n/` files (no Dart SDK needed).

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess`, ES2023, NodeNext; relative imports end in `.ts`; packages export
  `src/*.ts` directly.
- Tests sit next to code as `*.test.ts`; fixtures under `fixtures/`.
- Commit in logical steps. End every commit message with a blank line and
  `Co-Authored-By: <model name> <noreply@anthropic.com>` (or your vendor's equivalent).
