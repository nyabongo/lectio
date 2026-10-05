# Lectio

A companion to the daily Mass readings: their history, their original words, and a voice.

Most people hear the Sunday readings once, in translation, with no idea what the first hearers already knew. Lectio
gives each day's readings four things:

- **Follow:** the day's readings by reference, each linked to a public-domain or licensed text.
- **Understand:** who wrote it, to whom and why, and what the Hebrew, Greek or Latin says that English cannot.
- **Listen:** the day's notes as one narrated queue.
- **Share:** a permanent link and a preview card for every day, reading and note.

Lectio carries commentary, not the readings: it never stores the text of a modern Bible translation. Notes are
researched ahead of time by an AI agent on the owner's machine, checked by five gates (schema, evidence, licence
guard, two verifiers from different model families, merge rule) and, when anything is flagged, by a human reviewer.
Each passage is one JSON file in this repository, written once and reused every year the passage is read. The site
is static (Astro on GitHub Pages) with a JSON API that the Flutter apps read. There is no backend. See
[docs/architecture.md](docs/architecture.md).

## Quick start

Requires Node 22 (`nvm use` reads [.nvmrc](.nvmrc)) and npm.

```sh
npm ci
npm run verify                                   # what CI checks
npm run build:fixture -w apps/web                # build the site from fixture content into apps/web/dist
npm run research -- plan --days 14               # what a research run would do; needs `gh auth login`, no API key
npm run research -- --provider fake --max 1      # the research pipeline as a dry run against fakes (see below)
```

Unit tests are offline, and nothing above needs an API key. A fake research run ends with the passage `abandoned`
(fake provenance fails the schema gate) and exits 1; that is expected. Running Lectio for real (secrets, research, approving
content) is in the [operator handbook](docs/operator-handbook.md).

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

Product commands. Each delegates to one workspace (`npm run -w @lectio/<pkg> <script>`); pass arguments after `--`,
e.g. `npm run calendar:build -- --year 2026 --region kenya`. A command whose owning issue has not landed yet prints
`not implemented (L-NNN)`.

| Command                                               | Workspace            | What it does                                                                                     |
| ----------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `research`                                            | `@lectio/research`   | plan, research, fix up, translate and back-fill notes ([runbook](docs/runbooks/research-cli.md)) |
| `review:approve`                                      | `@lectio/gates`      | record a human approval on passage files                                                         |
| `content:validate`                                    | `@lectio/content`    | validate every passage and calendar file                                                         |
| `calendar:build`, `calendar:check`, `calendar:report` | `@lectio/calendar`   | build `calendar/<year>.json`, check it is current, report lectionary gaps                        |
| `lectionary:check`, `lectionary:crosscheck`           | `@lectio/lectionary` | check the lectionary data and cross-check it against an independent source                       |
| `corpus:find`, `corpus:licences`                      | `@lectio/corpus`     | look up original-language words; list corpus licences                                            |
| `corpus:import:greek` / `:hebrew` / `:latin` / `:lxx` | `@lectio/corpus`     | re-import a corpus from its pinned source                                                        |
| `guard:build`                                         | `@lectio/textguard`  | rebuild the hash-only licence-guard index                                                        |
| `audio:render`                                        | `@lectio/audio`      | render narration for approved passages                                                           |
| `runway`                                              | `@lectio/runway`     | check the next weeks for days without notes (CI runs it daily)                                   |
| `schema:emit`                                         | `@lectio/schema`     | write the JSON Schemas to `packages/schema/json/`                                                |
| `gates:docs`                                          | `@lectio/gates`      | not implemented yet (L-043)                                                                      |

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
tests/                    repo-level suites (content gates, repo setup, docs links); excluded from coverage
passages/                 the notes: one JSON file per passage (passages/i18n/<locale>/ for translations)
calendar/                 calendar/<year>.json, regional overrides, lectionary data
corpus/                   original-language corpora, each with LICENSE.md and SOURCE.json
config/                   lectio.config.json: every owner decision as a config value
docs/                     architecture, operator handbook, API, ADRs, decisions, runbooks
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

- [Operator handbook](docs/operator-handbook.md): owner setup (repository settings, Pages, secrets, domain), workflows
  and schedules, the weekly research routine, approving content, budgets, and where each owner decision lands.
- [Research CLI runbook](docs/runbooks/research-cli.md#no-such-section): every flag, the weekly routine, fix-ups, back-fill, costs.
- [Architecture](docs/architecture.md): how research, gates, approval, deploy and the apps fit together.
- [Static JSON API v1](docs/api.md) and the [content model](docs/content-model.md).
- [Configuration](config/MISSING.md): every config key, its default and the decision behind it.
- [CONTRIBUTING.md](CONTRIBUTING.md): branch and PR conventions, the coverage rule, providers, workflows, lockfile
  conflicts. [AGENTS.md](AGENTS.md) is the condensed version for AI agents; [CLAUDE.md](CLAUDE.md) points to it.
- Owner decisions: [001 Link-out provider](docs/decisions/001-linkout.md) ·
  [003 Auto-merge](docs/decisions/003-auto-merge.md) · [004 Research runner](docs/decisions/004-research-runner.md) ·
  [011 Lectionary source](docs/decisions/011-lectionary-source.md) · [012 Septuagint source](docs/decisions/012-lxx-source.md).
  Open decisions are listed in the [handbook](docs/operator-handbook.md#owner-decisions-and-where-they-land).
- Architecture decision records:
  [0001 TypeScript + npm workspaces](docs/adr/0001-typescript-npm-workspaces.md) ·
  [0002 Content keyed by passage](docs/adr/0002-content-keyed-by-passage.md) ·
  [0003 Never store reading text](docs/adr/0003-never-store-reading-text.md) ·
  [0004 Passage keys and book codes](docs/adr/0004-passage-keys-and-book-codes.md) ·
  [0005 Providers behind interfaces](docs/adr/0005-providers-behind-interfaces.md) ·
  [0006 96% coverage floor](docs/adr/0006-coverage-floor.md) · [0007 romcal](docs/adr/0007-romcal.md)

`tests/docs/links.test.ts` checks that every relative link and heading anchor in this file and in `docs/` resolves.

## Licence

The code in this repository is released under the [MIT Licence](LICENSE).

Content and data keep their own licences, recorded next to them (`npm run corpus:licences` lists the corpora):

| Data                                                                                   | Licence                      | Record                                                                                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Greek New Testament (SBLGNT, MorphGNT edition)                                         | CC BY 4.0 and CC BY-SA 3.0   | [corpus/grc-sblgnt](corpus/grc-sblgnt/LICENSE.md)                                                                        |
| Hebrew Bible (Open Scriptures Hebrew Bible, Westminster Leningrad Codex)               | CC BY 4.0; WLC public domain | [corpus/hbo-oshb](corpus/hbo-oshb/LICENSE.md)                                                                            |
| Clementine Vulgate                                                                     | public domain                | [corpus/lat-vulgate-clementine](corpus/lat-vulgate-clementine/LICENSE.md)                                                |
| Septuagint, deuterocanonical books (Swete, via LXX-Swete-1930)                         | **GPL-3.0-only**             | [corpus/grc-lxx](corpus/grc-lxx/LICENSE.md)                                                                              |
| Licence-guard index (hashes of public-domain English texts, no text)                   | public-domain sources        | [corpus/guard](corpus/guard/SOURCE.json)                                                                                 |
| Versification data (SIL libpalaso, STEPBible TVTMS)                                    | MIT; CC BY 4.0               | [packages/refs/data](packages/refs/data/SOURCE.json)                                                                     |
| Fonts (Cormorant Garamond, Gentium Plus, Noto Serif Hebrew, Noto Serif, Source Sans 3) | SIL Open Font Licence        | `OFL-*.txt` in [apps/web/public/fonts](apps/web/public/fonts) and [packages/sharecards/fonts](packages/sharecards/fonts) |

**The Swete Septuagint is copyleft.** Swete's edition (1907–1912) is in the public domain, but the digitised database
Lectio imports is published under the GNU GPL version 3, and `corpus/grc-lxx` is a modified version of it distributed
under the same licence ([decision 012](docs/decisions/012-lxx-source.md)). Anyone redistributing those files, or a
work built from them, takes on the GPL's terms; the MIT licence of the code does not cover them. MorphGNT's CC BY-SA
3.0 likewise carries share-alike terms.

Lectio never stores the text of a copyrighted modern Bible translation; readings link out to a public-domain or
licensed source instead ([ADR 0003](docs/adr/0003-never-store-reading-text.md)). The notes in `passages/` are
Lectio's own commentary, with short quotations kept under the licence guard's limits.
