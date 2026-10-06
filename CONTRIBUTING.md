# Contributing to Lectio

Work is planned as roadmap issues (`L-NNN`). Each issue is implemented in its own branch and pull request, often by
an AI agent in its own git worktree, in parallel with others. These conventions keep parallel work from colliding.

## Branches, titles, scope

- Branch: `L-NNN/short-slug` (for example `L-005/reference-parser`).
- PR title: `L-NNN: <issue title>`; the body says `Closes #<issue number>` and ticks or explains every acceptance
  criterion (the [PR template](.github/pull_request_template.md) has the checklist).
- **Touch only the paths listed in the issue's `Touches` line.** Shared files are named there explicitly when an
  issue may edit them: `package.json`, `package-lock.json`, `apps/web/astro.config.mjs`, workflow files, i18n
  catalogs. If you need a file that is not listed, stop and ask on the issue instead of editing it.
- Every workspace `package.json` and the lockfile were written once by L-001 for the whole roadmap, including the
  `@lectio/*` dependencies and the third-party packages each issue needs, and the npm scripts pointing at the files
  each issue will create. Implementing an issue normally means adding source files only.

## Before you push

```sh
npm run verify   # lint, format check, typecheck, tests with coverage, coverage floor, required-check registry
```

CI runs the same steps as separate required checks (`.github/workflows/ci.yml`).

## The coverage rule

- Unit coverage is **≥ 96% for lines, branches, functions and statements**, globally and for each source glob. The
  thresholds live in `vitest.config.ts`; `npm run test:coverage` fails below them.
- **Never lower coverage, a threshold, or `coverage.include`.** `npm run coverage:floor` fails if anyone does, and
  CODEOWNERS routes those files to the owner. Coverage counts every file under `packages/*/src`, `apps/*/src/lib` and
  `apps/web/src/sw`, imported by a test or not.
- Only `**/*.d.ts`, `**/*.test.*`, `**/fixtures/**` and `**/__generated__/**` are excluded. Put untestable glue
  (CLI entry points that only parse argv and call a tested function) in as few lines as possible and test the
  function behind it.
- The Flutter app has its own gate in `apps/mobile/tool/check_coverage.dart`; declare the threshold as
  `const double minCoverage = 96;` so `coverage:floor` can read it.

## Code rules

- **No logic in `scripts/`.** Files there are thin wrappers that parse arguments and call a tested function in a
  package (see `scripts/check-coverage-floor.mjs` → `packages/shared/src/coverage-floor.ts`).
- **Every external call goes through a provider interface** (`@lectio/providers`, L-008) with a deterministic fake.
  Live implementations live in their own `packages/provider-*` and are injected by the caller.
- **Unit tests are offline.** `vitest.setup.ts` starts an msw server that fails any request without a handler; use
  `server.use(...)` from `@lectio/shared/test-server` to answer requests in a test. Only the content-gates workflow
  (L-031) goes online; `npm run test:live` (L-212) runs contract suites against real services and is never part of
  CI.
- CLIs run with the workspace as the working directory (npm sets it); resolve repository paths from
  `process.env.INIT_CWD` or the repo root, not from `process.cwd()`.
- Pre-registered scripts look like `tsx ../../scripts/run-planned.mjs L-017 src/cli/build.ts`: once the target file
  exists it runs (with any arguments); until then it prints `not implemented (L-017)` and exits 1. Create the target
  at exactly that path.
- TypeScript is strict with `noUncheckedIndexedAccess`; relative imports carry the `.ts` extension; packages export
  their `src/*.ts` directly (no build step).
- Content PRs **never commit English Bible text**: commentary, references and link-outs only (see
  [ADR 0003](docs/adr/0003-never-store-reading-text.md)).
- Content PRs pass five gates before they merge: [docs/gates.md](docs/gates.md) lists every rule, and the
  [reviewer guide](docs/reviewer-guide.md) covers flagged PRs, labels and approval.

## Workflows and required checks

- Each new workflow gets its own file in `.github/workflows/`; do not add jobs to someone else's workflow.
- A workflow whose jobs are required checks:
  - never uses trigger-level `paths:` or `paths-ignore:` (a filtered required check never reports and blocks merges);
    instead a `changes` step decides whether there is work to do and exits green otherwise. That step diffs against
    the PR base on `pull_request`, and against `origin/main` for any other event (push, `workflow_dispatch`);
  - accepts `workflow_dispatch`, so the merge-rule job (L-031) can re-run it on the approval commit it pushes;
  - registers itself in `.github/required-checks/<workflow>.json` as `{ "workflow": "<file>.yml", "jobs": [...] }`.
    `npm run required-checks` validates the registry; setup.sh (L-032) builds branch protection from it.

## Lockfile conflicts

`package-lock.json` should rarely change after L-001. The lockfile's shape depends on the npm version, so npm is
pinned in the root `package.json` (`"packageManager": "npm@10.9.9"`, the npm bundled with Node 22). Run
`npm --version` before touching the lockfile and, if it differs, use `npx npm@10.9.9 install` (or
`npm install -g npm@10.9.9`). CI's `lockfile-sync` job installs exactly that version. When two PRs both change it and yours conflicts:

```sh
git fetch origin
git rebase origin/main
# if a package.json conflicts too, resolve it by hand first (keep both sides' dependencies)
# on the package-lock.json conflict: take main's version, then regenerate it from the merged manifests
git checkout origin/main -- package-lock.json
npm install
git add package-lock.json
git rebase --continue
npm run verify
git push --force-with-lease
```

The short version: rebase, take main's lockfile, `npm install`, commit. Never hand-merge lockfile hunks. CI's
`lockfile-sync` job fails if the committed lockfile does not match the manifests.

## Flutter

Flutter is not installed locally. Flutter work iterates through CI on a **draft PR** (`flutter.yml`, L-100) and is
marked ready for review once green.

The app's UI strings are generated from the site's catalogs (`apps/web/src/i18n/<locale>/*.json`) and the app's own
(`apps/mobile/lib/l10n/catalog/`). After changing either, run `npm run l10n:sync` (no Dart needed) and commit the
rewritten `apps/mobile/lib/l10n/app_*.arb` and `catalog.g.dart`; `npm run verify` fails until you do
(`apps/web/src/lib/mobile-l10n.test.ts`), and so does the `flutter` job's Dart check. `npm run l10n:sync -- --check`
only reports. The Node script is a byte-for-byte port of `apps/mobile/tool/sync_l10n.dart`: change the two together,
and regenerate `apps/mobile/test/fixtures/l10n/expected/` with the Dart tool when the output format changes.

## Commits by AI agents

AI agents commit in logical steps and end every commit message with a blank line and a co-author trailer naming the
model, for example:

```
Add reference parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Agents never merge their own PRs and never change repository settings or branch protection.
