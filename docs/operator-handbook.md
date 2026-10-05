# Operator handbook

Everything the owner does to run Lectio: the one-time setup, the secrets, what runs on its own and when, the weekly
research routine, approving content, budgets, and where each open owner decision lands in config and code. It is
for the repository owner (admin rights on `nyabongo/lectio`), not for readers of the site.

Lectio has no server to operate. The repository is the database, GitHub Actions checks and publishes, and GitHub
Pages serves a static site ([architecture](architecture.md)). The owner's work is: keep the secrets in place, run
research once a week on their own machine, approve what the gates send to review, and settle the open decisions.

## At a glance

| What                         | Where it runs                       | When                                 | Needs                                                |
| ---------------------------- | ----------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| Research (new notes)         | owner's machine, `npm run research` | weekly, by hand                      | `ANTHROPIC_API_KEY` in the shell, `gh` login         |
| Content gates and merge rule | GitHub Actions                      | every content PR, `/approve` comment | verifier keys in the `llm-verifiers` env             |
| Build and deploy             | GitHub Actions                      | every merge to `main`, daily 00:05   | Pages enabled (source: GitHub Actions)               |
| Runway monitor               | GitHub Actions                      | daily 07:17                          | nothing (the job's own token)                        |
| Narration audio              | deploy's "Render narration" step    | with each deploy                     | TTS and storage secrets, `tts.storage.publicBaseUrl` |

Times are in `Africa/Nairobi` (`site.timezone`).

## Owner setup (one time)

Do these in order (top to bottom). Agents never do them: they change repository settings, and only the owner may.

### Repository settings and branch protection

[`scripts/repo/setup.sh`](../scripts/repo/setup.sh) (L-032) sets branch protection on `main` (required checks from
[`.github/required-checks/`](../.github/required-checks) plus `merge-rule`, all pinned to the GitHub Actions app),
squash-only merges with auto-merge and branch deletion on, every roadmap and runtime label (`approved`,
`needs-review`, `research`, `auto-merge-candidate`, `gates-failed`, `ios-build`, `content-issue` …), the Pages source,
and the `llm-verifiers` environment. It is idempotent.

```sh
gh auth status                       # logged in as the owner, with admin rights
scripts/repo/setup.sh --dry-run      # prints every write; changes nothing
scripts/repo/setup.sh                # applies
```

Run it again whenever a new file lands in `.github/required-checks/` on `main`: that is how a new workflow becomes a
required check. `scripts/repo/setup.sh --help` lists the options (`--repo`, `--registry`).

### GitHub Pages

The script sets the Pages source to **GitHub Actions**. Check it under Settings → Pages; with any other source the
deploy workflow fails at its first step ("configure-pages"). The site is then served at the URL in `site.baseUrl`
(`https://nyabongo.github.io/lectio/` by default). The deploy job's smoke step fails if the configured URL does not
answer, so `site.baseUrl` and `site.basePath` must match the real Pages URL.

### Secrets

Never commit a key. Local keys live in the shell (for example an untracked `.env` loaded by direnv); CI keys live in
GitHub secrets.

| Secret                                                  | Where                       | Used by                                                                       | Without it                                                         |
| ------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY`                                     | owner's shell               | research CLI (`run`, `fixup`, `translate`, back-fill batches)                 | live research stops; `plan` and back-fill estimates still work     |
| `ANTHROPIC_API_KEY`                                     | environment `llm-verifiers` | `verifiers` job in `content-gates.yml` (confirmer)                            | verifiers are skipped and every content PR goes to review          |
| `OPENAI_API_KEY`                                        | environment `llm-verifiers` | `verifiers` job in `content-gates.yml` (refuter)                              | as above                                                           |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`               | repository secrets          | deploy's "Render narration" step (`@lectio/provider-azure-tts`)               | narration is rendered with the fake voice and nothing is published |
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | repository secrets          | deploy's "Render narration" step (`@lectio/provider-s3`)                      | as above                                                           |
| `R2_ACCOUNT_ID` or `S3_ENDPOINT`                        | repository secrets          | deploy's "Render narration" step (`@lectio/provider-s3`, the bucket endpoint) | as above                                                           |

**Move the LLM keys into `llm-verifiers`.** The setup script creates the environment and limits it to `main`, but it
does not move secrets. The `verifiers` job is the only job that runs in that environment, so keys kept there cannot
reach any other workflow or a pull request's code.

```sh
gh secret set ANTHROPIC_API_KEY --env llm-verifiers --repo nyabongo/lectio   # paste the key when asked
gh secret set OPENAI_API_KEY --env llm-verifiers --repo nyabongo/lectio
gh secret list --env llm-verifiers --repo nyabongo/lectio                    # both listed
gh secret delete ANTHROPIC_API_KEY --repo nyabongo/lectio                    # remove the repository-level copies
gh secret delete OPENAI_API_KEY --repo nyabongo/lectio
```

`verifiers.mode` is `auto`: a verifier runs live when its key is present and is skipped otherwise. A skipped verifier
never auto-merges (`autoMerge.requireBothVerifiers`), so missing keys make everything wait for a person rather than
pass unchecked.

**TTS and storage secrets** are read only by the "Render narration" step of `deploy.yml` (L-082), which runs only on
`main`. Create them once decision L-205 ([#102](https://github.com/nyabongo/lectio/issues/102)) settles the vendor;
see [Narration audio](#narration-audio). The deploy passes no region to the storage client, so it uses `auto`, which
is what R2 expects. `S3_REGION` is read only from a local shell (a manual `audio:render` or `npm run test:live`), for
a bucket that needs another region.

`npm run test:live` (provider contract suites against real services) reads the same variables from your shell. It
never runs in CI.

### Domain and hosting

The default is GitHub Pages at `https://nyabongo.github.io/lectio/` (decision L-206,
[#103](https://github.com/nyabongo/lectio/issues/103), open). Links must keep working for years, so choose the domain
before a public launch. To move to a custom domain:

1. Point the domain's DNS at GitHub Pages and add it under Settings → Pages → Custom domain (with the GitHub Actions
   source the domain is a repository setting; enforce HTTPS once the certificate is issued).
2. In a config PR, set `site.customDomain` (for example `lectio.example.org`), `site.baseUrl`
   (`https://lectio.example.org/`) and `site.basePath` (`''` at a domain root). The deploy workflow then writes a
   `CNAME` file into the build, and the smoke step checks the new URL.
3. Build the apps with `--dart-define=LECTIO_API_BASE_URL=https://lectio.example.org/api/v1/` (or change the default
   in `apps/mobile/lib/data/api_client.dart`). App links (`.well-known`) need a domain root.

Config changes always go through human review; they never auto-merge.

### Narration audio

Narration is rendered on every deploy, before the site build, by the "Render narration" step of `deploy.yml`
(L-082): `npm run audio:render -- --auto`. Under `--auto`, two things alone decide whether audio goes live: the
secrets above (both the Azure and the storage set) and `tts.storage.publicBaseUrl` in the config. `tts.provider` and
`tts.storage.provider` do not matter to the deploy; they only set the defaults for a manual `audio:render` run.

- **Live** (all present): the Azure voice renders the missing narration into the bucket and the build publishes the
  audio URLs in the pages and the API. Audio is keyed by a hash of the text, voice and engine version, so only new
  or changed notes are billed, within `tts.monthlyCharBudget` (1,000,000 characters by default).
- **Not live** (anything missing): the fake voice renders into `.audio-out`, uploaded as the workflow artifact
  `narration-fake` for inspection only. Nothing is published and every `audio` stays `null`.

The step never fails the deploy (`continue-on-error`); the job summary says which case ran, what it rendered and what
is missing. The decision itself is L-205 ([#102](https://github.com/nyabongo/lectio/issues/102), open); the default
plan is Azure AI Speech with Kenyan English and Kiswahili voices, stored in a public Cloudflare R2 bucket through its
S3 API. To turn it on:

1. Create the Azure Speech resource, the R2 bucket (public read, with a public URL) and an R2 API token.
2. Add the secrets in the table above.
3. In a config PR: set `tts.storage.publicBaseUrl` to the bucket's public URL, check `tts.voices` and
   `tts.monthlyCharBudget`, and set `site.features.listen: true` to show the Listen button.
4. After the next deploy, read the "Render narration" job summary.

To try the pipeline locally without any account: `npm run audio:render -- --provider fake --storage fs:.audio-out
--dry-run`.

## Workflows and schedules

| Workflow                                                                             | Trigger                                               | Secrets                                       | What it does                                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`ci.yml`](../.github/workflows/ci.yml)                                              | push, PR                                              | none                                          | lint and format, typecheck, unit tests with the 96% coverage floor, lockfile sync, actionlint, check registry           |
| [`content-checks.yml`](../.github/workflows/content-checks.yml)                      | PR                                                    | none                                          | deterministic gates (schema, evidence, licence) on content PRs; read-only                                               |
| [`content-gates.yml`](../.github/workflows/content-gates.yml)                        | after `Content checks`, `/approve` comments, dispatch | `llm-verifiers` env                           | trusted re-run of the gates, the two verifiers, the merge rule, approval commit and merge                               |
| [`calendar.yml`](../.github/workflows/calendar.yml)                                  | push, PR                                              | none                                          | `calendar:check` (committed calendars are current) and `calendar:report` (no undocumented gaps)                         |
| [`web.yml`](../.github/workflows/web.yml), [`e2e.yml`](../.github/workflows/e2e.yml) | push, PR                                              | none                                          | site build from fixture content; end-to-end tests                                                                       |
| [`flutter.yml`](../.github/workflows/flutter.yml)                                    | push, PR (`ios-build` label for the iOS build)        | none                                          | Flutter analyse, tests and builds                                                                                       |
| [`deploy.yml`](../.github/workflows/deploy.yml)                                      | push to `main`, dispatch, daily 21:05 UTC             | Azure and S3/R2 secrets (narration step only) | renders narration, then builds the site, API, share cards and search index; deploys to Pages; smoke-checks the live URL |
| [`runway.yml`](../.github/workflows/runway.yml)                                      | daily 04:17 UTC, dispatch                             | none                                          | the content runway monitor, below                                                                                       |

Merges made by the merge-rule job use the Actions token, which does not fire `push`, so that job dispatches
`deploy.yml` itself. The daily deploy at 00:05 Nairobi time moves `/` to the new day. You can re-run any of these
from the Actions tab ("Run workflow").

There is no scheduled research job: research runs only on the owner's machine
([decision 004](decisions/004-research-runner.md)).

### Runway monitor

Every morning `runway.yml` checks the next `runway.windowDays` (21) days for readings without approved notes. While
more than `runway.maxMissingDays` (7) days are missing it keeps one issue open (marked `<!-- lectio-runway -->`) with
the list; it updates and closes that issue once the count is back within the limit. An open runway issue means:
research sooner, or approve the waiting PRs. To see the report without touching the issue:
`npm run runway -- --dry-run`.

## Weekly research routine

The full guide, with flags, output and troubleshooting, is the [research CLI runbook](runbooks/research-cli.md). In
short, once a week:

```sh
git switch main && git pull && npm ci
npm run research -- plan --from <today> --days 14              # what it would do; spends nothing
npm run research -- --from <today> --days 14 --budget 20       # research and open one PR per passage
```

Then watch the PRs: the content gates run on each, most merge on their own, and the rest get `needs-review`. When the
gates find something a repair can fix, `npm run research -- fixup --pr <n> --budget 3` pushes a fix to the same PR
([fix-up mode](runbooks/research-cli.md#fix-up-mode)). The planner stops opening PRs when `reviewer.maxOpenReviewPrs`
review PRs are open and plans at most `reviewer.weeklyCapacity` passages, so research never outruns review.

Kiswahili translations of approved passages use the same flags: `npm run research -- translate --locale sw --days 14
--budget 5`. Translations always wait for a human reviewer.

### Budgets

| Ceiling     | Config key                         | Default   | Rule                                                                                   |
| ----------- | ---------------------------------- | --------- | -------------------------------------------------------------------------------------- |
| Per run     | `research.budget.perRunUsd`        | $25       | a live run needs `--budget <usd>`, at most this; without it nothing is spent           |
| Per passage | `research.budget.perPassageUsd`    | $1.50     | research plus repairs; a passage that hits it stops cleanly and is planned again later |
| Back-fill   | `research.budget.backfillTotalUsd` | $0        | caps each back-fill batch; `0` means back-fill only ever estimates                     |
| Narration   | `tts.monthlyCharBudget`            | 1,000,000 | characters rendered per month                                                          |

Raising a ceiling is a config PR, which always needs human review. See [Costs](runbooks/research-cli.md#costs).

### Back-fill

`npm run research -- backfill` estimates what researching every passage in the committed calendars would cost
(nothing is called). To research batches, set `research.budget.backfillTotalUsd` in a config PR, then run
`npm run research -- backfill --execute --budget 20` as often as the budget allows. The ceiling applies per batch, so
keep your own running total ([Back-fill](runbooks/research-cli.md#back-fill)).

## Approving content

A content PR merges by itself only when every deterministic gate passes, both verifiers support every claim at 0.9 or
more and nothing is refuted or flagged ([decision 003](decisions/003-auto-merge.md)). Anything else is labelled
`needs-review` and waits for you.

- **Approve:** read the passage file and the gates comment, then add the **`approved` label** or comment
  **`/approve`** (on the first line). Only accounts in `reviewer.githubHandles` count, and only after the last content
  commit; you may approve your own research PR. The merge-rule job writes the review block in an approval commit and
  merges.
- **Reject:** close the PR. The key is then skipped by research for good (reopen the PR to try again).
- **Change:** push a commit to the branch yourself, or run `fixup`; a new content commit resets any approval.
- PRs that touch `config/**`, `packages/gates/**` or `.github/**`, and PRs from forks, never merge from the gates; a
  maintainer merges them by hand after review.
- `npm run review:approve -- passages/<KEY>.json --reviewer <handle>` records a human approval in a local file (for
  edits made outside a research PR).

See [Approving a PR](runbooks/research-cli.md#approving-a-pr) for the details.

## Calendar upkeep

`calendar/<year>.json` is committed for 2026–2028. Before a new year is needed, build it in a PR:
`npm run calendar:build -- --year 2029`, then `npm run calendar:check` and `npm run calendar:report`. The Kenya
overrides live in `calendar/overrides/kenya.json` (decision L-209, open).

## Owner decisions and where they land

Every decision is a config value with a default, so nothing waits on the owner; changing one is a config PR.
[config/README.md](../config/README.md#keys-defaults-and-decisions) lists every key and its default.

| Issue                                                 | Decision                                    | Status                     | Config keys                                                                                        | Consumed by                                                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#100](https://github.com/nyabongo/lectio/issues/100) | L-201 link-out, auto-merge, research runner | recorded (some items open) | `linkout.*`, `autoMerge.*`, `research.*`                                                           | [001](decisions/001-linkout.md), [003](decisions/003-auto-merge.md), [004](decisions/004-research-runner.md); `packages/refs`, `packages/gates/src/merge-rule`, `packages/research`                                         |
| [#101](https://github.com/nyabongo/lectio/issues/101) | L-202 reviewer and weekly capacity          | open                       | `reviewer.githubHandles`, `weeklyCapacity`, `maxOpenReviewPrs`, `approvalLabel`, `approvalCommand` | merge rule and approvals (`packages/gates/src/merge-rule`, `src/review`, `content-gates.yml`); research planner throttle (`packages/research/src/plan`); translation review (`packages/gates/src/schema-gate/translations`) |
| [#102](https://github.com/nyabongo/lectio/issues/102) | L-205 TTS vendor, voices, audio storage     | open                       | `tts.*`, `site.features.listen`                                                                    | `packages/audio`, `packages/providers` (`createProviders`), `provider-azure-tts`, `provider-s3`, the deploy's "Render narration" step (L-082), the Listen UI (`apps/web/src/lib/day.ts`, L-085)                             |
| [#103](https://github.com/nyabongo/lectio/issues/103) | L-206 domain and hosting                    | open                       | `site.baseUrl`, `site.basePath`, `site.customDomain`                                               | `apps/web/src/lib/site.ts`, `deploy.yml` (CNAME, smoke check), the API root ([api.md](api.md#base-url)), the Flutter `LECTIO_API_BASE_URL` default                                                                          |
| [#104](https://github.com/nyabongo/lectio/issues/104) | L-207 verifier model families               | open                       | `verifiers.confirmer`, `verifiers.refuter`, `verifiers.mode`, `pricing`                            | `packages/gates/src/verifier-gate`, `packages/gates/src/ci/providers.ts`, `provider-openai`, the `verifiers` job and its `llm-verifiers` secrets, the About page                                                            |
| [#105](https://github.com/nyabongo/lectio/issues/105) | L-208 Kiswahili reviewer, glossary, policy  | open                       | `site.locales`, `reviewer.githubHandles`                                                           | `npm run research -- translate` (L-112), translation schema gate (never auto-merges), `passages/i18n/sw/`, the `sw/` site and API mirror (L-110, L-113)                                                                     |
| [#106](https://github.com/nyabongo/lectio/issues/106) | L-209 Kenya calendar sign-off (KCCB Ordo)   | open                       | `site.region` (data: `calendar/overrides/kenya.json`)                                              | `packages/calendar/src/overrides`, `calendar:build` / `calendar:check`, `calendar.yml`                                                                                                                                      |
| [#107](https://github.com/nyabongo/lectio/issues/107) | L-210 quotation-length limits               | open                       | `licenceGuard.*`                                                                                   | gate 3 (`packages/gates/src/licence-gate`), the translation gate, the research prompt and pre-validation (`packages/research/src/agent`, `src/validate`)                                                                    |
| [#108](https://github.com/nyabongo/lectio/issues/108) | L-211 lectionary edition and source         | provisional                | `lectionary.*`                                                                                     | [011](decisions/011-lectionary-source.md); `packages/lectionary`, `lectionary:check` / `lectionary:crosscheck`                                                                                                              |

To settle an open decision: comment on its issue, and if the default changes, open a config PR (and update the
decision record in `docs/decisions/`). Model ids, tool versions and prices in `config/lectio.config.json` are
placeholders confirmed by L-039 (Anthropic) and L-040 (OpenAI); L-041 revisits the budgets after the first real run.

## Adding a link-out provider

Each reading links out to a public-domain or licensed text; Lectio never stores the reading itself
([ADR 0003](adr/0003-never-store-reading-text.md), [decision 001](decisions/001-linkout.md)). A new target is a config
entry, not code:

1. Add an entry under `linkout.providers` with a `label`, `enabled: true` and a URL `template`. Tokens: `{book}`,
   `{bookName}`, `{bookSlug}`, `{chapter}`, `{verse}`, `{query}`, `{osis}`, `{usfm}`, `{date}`; add
   `versification` (for example `vulgate`) if the site numbers verses differently.
2. Set `linkout.provider` to its key (it must be enabled).
3. Open the config PR. CI rebuilds the calendars in memory and `calendar.yml` fails until the committed
   `calendar/<year>.json` files carry the new links, so run `npm run calendar:build -- --year 2026 --year 2027
--year 2028` in the same PR.

```json
{
  "linkout": {
    "provider": "usccb",
    "providers": { "usccb": { "enabled": true } }
  }
}
```

The built-in entries are `drbo` (default, Douay-Rheims on drbo.org, per chapter), `usccb` and `universalis` (both
disabled). The full rules are in [config/README.md](../config/README.md#adding-a-link-out-provider).
