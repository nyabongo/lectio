# Lectio configuration

`lectio.config.json` holds every owner decision as a config value. Code never reads it directly: it calls
`loadConfig()` from `@lectio/config` (`packages/config`), which

1. picks the file: an explicit path argument, else `$LECTIO_CONFIG` (relative to the repository root, or absolute),
   else `config/lectio.config.json` in the repository root (if absent, the built-in defaults are used);
2. deep-merges it over the built-in defaults (`packages/config/src/defaults.ts`): objects merge key by key, arrays
   and scalars replace, so a file only needs the keys it changes. A merge can add or change a key but never remove
   one: to turn the built-in `drbo` entry into a template provider, add a new entry under another name instead;
3. validates the result against the JSON Schema (`packages/config/src/schema.ts`, every object closed to unknown
   keys) and the cross-field rules below, throwing a `ConfigError` whose issues carry JSON pointers such as
   `/verifiers/refuter/family`;
4. returns a deeply frozen, typed `LectioConfig`.

The committed file spells out every default so the owner can see and change them in one place. Changes to
`config/**` always need human review; they can never be auto-merged (L-028).

## Cross-field rules

- `verifiers.confirmer.family` must differ from `verifiers.refuter.family` (two independent model families).
- `site.defaultLocale` must be listed in `site.locales`.
- `linkout.provider` must name an entry of `linkout.providers` that is `enabled`.
- Each link-out provider sets exactly one of `builtin` or `template`.
- Every model in `research.models` and `verifiers` must have a `pricing` entry.
- A model's `family` must match its id prefix (`claude-` is anthropic, `gpt-`/`o<digit>` is openai, `gemini-` is
  google), so a mislabelled family cannot defeat the independence rule. Ids without a known prefix trust the label.
- `licenceGuard.maxQuotedWords` must not exceed `licenceGuard.maxExcerptWords`.

## Keys, defaults and decisions

Decision issues: L-201 (recorded owner decisions of 2026-10-04), L-202 (reviewer and weekly capacity), L-205 (TTS
and storage), L-206 (domain), L-207 (verifier families), L-210 (quotation limits), L-211 (lectionary source).

| Key                                      | Default                                                                                                                                             | Decision / reader                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `site.baseUrl`                           | `https://nyabongo.github.io/lectio/`                                                                                                                | L-206                                                                              |
| `site.basePath`                          | `/lectio`                                                                                                                                           | L-206                                                                              |
| `site.customDomain`                      | `''` (none; CNAME and `.well-known` only when set)                                                                                                  | L-206                                                                              |
| `site.timezone`                          | `Africa/Nairobi` (an IANA zone name, case as in the tz database; an unknown zone is a config error)                                                 | L-050, L-051                                                                       |
| `site.region`                            | `kenya`                                                                                                                                             | L-015                                                                              |
| `site.defaultLocale`                     | `en`                                                                                                                                                | L-051                                                                              |
| `site.locales`                           | `['en']` (L-110 adds `sw`)                                                                                                                          | L-051, L-110                                                                       |
| `site.features.listen`                   | `false`                                                                                                                                             | L-205                                                                              |
| `content.root`                           | `.` (web build and e2e use `apps/web/test/fixtures/content`)                                                                                        | L-050                                                                              |
| `linkout.provider`                       | `drbo`                                                                                                                                              | L-201 (recorded)                                                                   |
| `linkout.providers`                      | built-in `drbo` (enabled); `usccb`, `universalis` (disabled)                                                                                        | L-201 (recorded), L-007                                                            |
| `linkout.providers.*.label`              | display name                                                                                                                                        | L-007                                                                              |
| `linkout.providers.*.enabled`            | `true` for `drbo` only                                                                                                                              | L-007                                                                              |
| `linkout.providers.*.builtin`            | `drbo` (public-domain Douay-Rheims, per chapter)                                                                                                    | L-007                                                                              |
| `linkout.providers.*.template`           | URL with tokens `{book}` `{bookName}` `{bookSlug}` `{chapter}` `{verse}` `{query}` `{osis}` `{usfm}` `{date}`                                       | L-007                                                                              |
| `linkout.providers.*.versification`      | `vulgate` for `drbo`                                                                                                                                | L-006, L-007                                                                       |
| `linkout.studyText`                      | `none` (no reading text shown or stored)                                                                                                            | L-201 (recorded)                                                                   |
| `reviewer.githubHandles`                 | `['nyabongo']`                                                                                                                                      | L-202 (open)                                                                       |
| `reviewer.weeklyCapacity`                | `15`                                                                                                                                                | L-202 (open)                                                                       |
| `reviewer.maxOpenReviewPrs`              | `15`                                                                                                                                                | L-202 (open)                                                                       |
| `reviewer.approvalLabel`                 | `approved`                                                                                                                                          | L-202 (open)                                                                       |
| `reviewer.approvalCommand`               | `/approve`                                                                                                                                          | L-202 (open)                                                                       |
| `autoMerge.enabled`                      | `true`                                                                                                                                              | L-201 (recorded)                                                                   |
| `autoMerge.minSupport`                   | `0.9`                                                                                                                                               | L-201 (recorded)                                                                   |
| `autoMerge.requireBothVerifiers`         | `true`                                                                                                                                              | L-201 (recorded)                                                                   |
| `autoMerge.maxRefutations`               | `0`                                                                                                                                                 | L-201 (recorded)                                                                   |
| `autoMerge.sensitiveClaimsRequireReview` | `true`                                                                                                                                              | L-201 (awaiting owner confirmation)                                                |
| `autoMerge.flagsRequireReview`           | `true`                                                                                                                                              | L-201 (awaiting owner confirmation)                                                |
| `autoMerge.passagesOnly`                 | `true`                                                                                                                                              | L-201 (awaiting owner confirmation)                                                |
| `research.runner`                        | `local-cli` (CI never runs research)                                                                                                                | L-201 (recorded)                                                                   |
| `research.defaultDays`                   | `14`                                                                                                                                                | L-201                                                                              |
| `research.prGrouping`                    | `passage` (one PR per passage)                                                                                                                      | L-201                                                                              |
| `research.maxRepairs`                    | `2`                                                                                                                                                 | L-201                                                                              |
| `research.budget.perPassageUsd`          | `1.5`                                                                                                                                               | L-201 (open), L-041                                                                |
| `research.budget.perRunUsd`              | `25`                                                                                                                                                | L-201 (open), L-041                                                                |
| `research.budget.backfillTotalUsd`       | `0` (back-fill is dry-run only)                                                                                                                     | L-201 (open), L-041                                                                |
| `research.models.generator`              | `{ family: 'anthropic', model: 'claude-opus-5-5' }`                                                                                                 | placeholder; L-039 confirms id and price; L-041                                    |
| `research.models.repair`                 | `{ family: 'anthropic', model: 'claude-opus-5-5' }`                                                                                                 | placeholder; L-039 confirms id and price; L-041                                    |
| `research.models.cheap`                  | `{ family: 'anthropic', model: 'claude-haiku-4-5-20251001' }` (classification, extraction, short rewrites)                                          | placeholder; L-039 confirms id and price                                           |
| `runway.windowDays`                      | `21`                                                                                                                                                | L-073                                                                              |
| `runway.maxMissingDays`                  | `7`                                                                                                                                                 | L-073                                                                              |
| `verifiers.confirmer`                    | `{ family: 'anthropic', model: 'claude-sonnet-5-5' }`                                                                                               | L-207 (open); placeholder; L-039 confirms id and price                             |
| `verifiers.refuter`                      | `{ family: 'openai', model: 'gpt-5' }`                                                                                                              | L-207 (open); placeholder; L-040 confirms id and price                             |
| `verifiers.mode`                         | `auto` (live when the secret exists, else skipped)                                                                                                  | L-207 (open), L-031                                                                |
| `tts.provider`                           | `fake`                                                                                                                                              | L-205 (open)                                                                       |
| `tts.voices`                             | `{ en: 'en-KE-AsiliaNeural', sw: 'sw-KE-ZuriNeural' }`                                                                                              | L-205 (open)                                                                       |
| `tts.monthlyCharBudget`                  | `1000000`                                                                                                                                           | L-205 (open)                                                                       |
| `tts.storage.provider`                   | `fs`                                                                                                                                                | L-205 (open)                                                                       |
| `tts.storage.publicBaseUrl`              | `''`                                                                                                                                                | L-205 (open), L-082                                                                |
| `licenceGuard.maxQuotedWords`            | `10`                                                                                                                                                | L-210 (open)                                                                       |
| `licenceGuard.maxExcerptWords`           | `25`                                                                                                                                                | L-210 (open)                                                                       |
| `licenceGuard.maxCommentaryRunWords`     | `12`                                                                                                                                                | L-210 (open)                                                                       |
| `licenceGuard.maxBibleRunWords`          | `12`                                                                                                                                                | L-210 (open)                                                                       |
| `licenceGuard.shingleSize`               | `8`                                                                                                                                                 | L-210 (open), L-013                                                                |
| `lectionary.edition`                     | `OLM-1981`                                                                                                                                          | L-211 (provisional)                                                                |
| `lectionary.primarySource`               | `litcal` (Liturgical Calendar API lectionary corpus)                                                                                                | L-211 (provisional)                                                                |
| `lectionary.crossCheckSource`            | `olm-1981` (published OLM 1981 index; also the gap filler)                                                                                          | L-211 (provisional)                                                                |
| `lectionary.provisional`                 | `true`                                                                                                                                              | L-211                                                                              |
| `tools.anthropic.webSearch`              | `web_search_20260209`                                                                                                                               | placeholder; L-039 confirms the tool version                                       |
| `tools.anthropic.webFetch`               | `web_fetch_20260209`                                                                                                                                | placeholder; L-039 confirms the tool version                                       |
| `pricing`                                | USD per million tokens per model id: `claude-opus-5-5` 4/20, `claude-sonnet-5-5` 2/10, `claude-haiku-4-5-20251001` 1/5, `gpt-5` 1.25/10, `fake` 0/0 | placeholder; L-039 (Anthropic) and L-040 (OpenAI) confirm prices; L-008 cost meter |
| `pricing.*.inputPerMTok`                 | per model (required)                                                                                                                                | placeholder; L-039 confirms                                                        |
| `pricing.*.outputPerMTok`                | per model (required)                                                                                                                                | placeholder; L-039 confirms                                                        |
| `pricing.*.cachedInputPerMTok`           | per model (optional)                                                                                                                                | placeholder; L-039 confirms                                                        |
| `pricing.*.webSearchPerThousand`         | per model (optional)                                                                                                                                | placeholder; L-039 confirms                                                        |

Model ids, tool versions and prices are placeholders: L-039 confirms the Anthropic ones (the `_20260209` tool
versions need Opus 5.5 or Sonnet 5.5; Haiku 4.5 uses the basic `web_search_20250305` / `web_fetch_20250910`), L-040
the OpenAI ones, and L-041 revisits budgets after the first real run.

## Adding a link-out provider

Add an entry under `linkout.providers` with a `label`, `enabled: true` and a `template`, then set `linkout.provider`
to its key. No code change is needed (L-007 fills the template).

```json
{ "linkout": { "provider": "usccb", "providers": { "usccb": { "enabled": true } } } }
```
