# Lectio

A companion to the daily Mass readings: their history, their original words, and a voice.

Lectio carries commentary, not the readings. Notes are researched ahead of time, checked by automatic gates and
(when flagged) a human reviewer, stored as one JSON file per passage in this repository, and served as a static site.
There is no backend. See [docs/architecture.md](docs/architecture.md).

## Quick start

Requires Node 22 (`nvm use` reads [.nvmrc](.nvmrc)) and npm.

```sh
npm ci
npm run verify
```

## Commands

| Command                                                    | What it does                                                                                       |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run verify`                                           | Everything CI checks: lint, format check, typecheck, tests with coverage, coverage floor, registry |
| `npm run lint` / `npm run format:check` / `npm run format` | ESLint (flat config + typescript-eslint) / Prettier check / Prettier write                         |
| `npm run typecheck`                                        | `tsc` for root config files, then `npm run typecheck --workspaces --if-present`                    |
| `npm test` / `npm run test:watch`                          | Vitest across every project, offline                                                               |
| `npm run test:coverage`                                    | Vitest with v8 coverage; fails below 96% on lines, branches, functions or statements               |
| `npm run coverage:floor`                                   | Fails if a coverage threshold (vitest or Dart) is set below 96 or `coverage.include` is narrowed   |
| `npm run required-checks`                                  | Validates `.github/required-checks/*.json` against the workflows                                   |
| `npm run test:live`                                        | Provider contract suites against real services (needs keys; L-212). Never part of CI               |

Pre-registered product commands. Each delegates to one workspace (`npm run -w @lectio/<pkg> <script>`) and prints
`not implemented (L-NNN)` until the owning issue lands. Pass arguments after `--`, e.g.
`npm run calendar:build -- --year 2026 --region kenya`.

| Command                                               | Workspace            | Owner                         |
| ----------------------------------------------------- | -------------------- | ----------------------------- |
| `research`                                            | `@lectio/research`   | L-038                         |
| `calendar:build`, `calendar:check`                    | `@lectio/calendar`   | L-017                         |
| `calendar:report`                                     | `@lectio/calendar`   | L-070                         |
| `corpus:find`, `corpus:licences`                      | `@lectio/corpus`     | L-009                         |
| `corpus:import:greek` / `:hebrew` / `:latin` / `:lxx` | `@lectio/corpus`     | L-010 / L-011 / L-012 / L-071 |
| `guard:build`                                         | `@lectio/textguard`  | L-013                         |
| `content:validate`                                    | `@lectio/content`    | L-018                         |
| `lectionary:check`, `lectionary:crosscheck`           | `@lectio/lectionary` | L-016                         |
| `review:approve` (and the workspace script `gates`)   | `@lectio/gates`      | L-023                         |
| `gates:docs`                                          | `@lectio/gates`      | L-043                         |
| `audio:render`                                        | `@lectio/audio`      | L-081                         |
| `schema:emit`                                         | `@lectio/schema`     | L-004                         |
| `runway`                                              | `@lectio/runway`     | L-073                         |

## Layout

```
apps/web                  Astro static site + PWA (L-050…)
apps/mobile               Flutter app (L-100…; built in CI only)
packages/shared           helpers + repo tooling logic; the template for new packages
packages/config           typed config with defaults for every owner decision
packages/schema           content JSON schemas (subpath exports, no barrel)
packages/refs             references, passage keys, versification, link-outs
packages/providers        provider interfaces, fakes, contract suites
packages/provider-*       live providers: gh, fetch, anthropic, openai, azure-tts, s3
packages/corpus           Greek/Hebrew/Latin corpora: format, normalisers, query API, importers
packages/textguard        hash-only shingle index for the licence guard
packages/calendar         liturgical calendar (romcal + overrides) and calendar CLIs
packages/lectionary       lectionary reference data and resolver
packages/content          content repository loader and day resolver
packages/gates            the five pull-request gates, runner, review helper, CI orchestration
packages/research         local research CLI
packages/runway           content runway monitor
packages/audio            narration scripts and TTS rendering
packages/sharecards       share-card renderer
scripts/                  thin CLI wrappers only (logic lives in packages)
tests/                    repo-level suites (content gates, docs checks); excluded from coverage
```

Every workspace's `package.json`, and the lockfile, were written once by L-001 for the whole roadmap: implementing
issues add source files, not dependencies.

## Adding a package

1. Copy [packages/shared](packages/shared/README.md)'s shape: `packages/foo/package.json` (name `@lectio/foo`,
   `"type": "module"`, `exports` pointing at `src/*.ts`, a `typecheck` script), `tsconfig.json` extending
   `../../tsconfig.base.json`, and `src/` with `*.test.ts` next to the code.
2. Run `npm install` once so the workspace is linked and recorded in `package-lock.json`.

Nothing else: `npm run typecheck` runs every workspace's `typecheck` script, ESLint and Prettier cover the whole repo,
vitest turns each `packages/*` directory into a project (named after its package), and `coverage.include` already
measures `packages/*/src/**` at the 96% floor.

## Documentation

- [CONTRIBUTING.md](CONTRIBUTING.md): branch and PR conventions, the coverage rule, providers, workflows, lockfile
  conflicts. [AGENTS.md](AGENTS.md) is the condensed version for AI agents; [CLAUDE.md](CLAUDE.md) points to it.
- [docs/architecture.md](docs/architecture.md): how research, gates, approval, deploy and the apps fit together.
- Architecture decision records:
  [0001 TypeScript + npm workspaces](docs/adr/0001-typescript-npm-workspaces.md) ·
  [0002 Content keyed by passage](docs/adr/0002-content-keyed-by-passage.md) ·
  [0003 Never store reading text](docs/adr/0003-never-store-reading-text.md) ·
  [0004 Passage keys and book codes](docs/adr/0004-passage-keys-and-book-codes.md) ·
  [0005 Providers behind interfaces](docs/adr/0005-providers-behind-interfaces.md) ·
  [0006 96% coverage floor](docs/adr/0006-coverage-floor.md)
