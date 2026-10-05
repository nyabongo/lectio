# 004 · Research runner, budgets and the online exception (L-201, brief decision 4)

- **Status:** Accepted, with items awaiting owner confirmation. The owner recorded the runner decision on 2026-10-04 ([#100](https://github.com/nyabongo/lectio/issues/100)). The budget figures and the online exception are defaults until the owner confirms or amends them.
- **Issue:** #100 (roadmap id L-201)
- **Brief question:** "Where does the research job run, your machine or GitHub Actions, and what is the budget ceiling for back-filling the full cycle?"
- **Implemented by:** L-003 (#2, config keys), L-034 to L-038 (#37 to #41, research CLI), L-072 (#69, back-fill mode), L-031 (#34, content-gates workflow), L-041 (#44, first real run and cost report)
- **Related:** [ADR 0005 · Providers behind interfaces](../adr/0005-providers-behind-interfaces.md), [003 · Auto-merge](003-auto-merge.md), [011 · Lectionary source](011-lectionary-source.md)

## Decision

**Research runs on the owner's machine as a local CLI. CI never runs research.**

1. **Runner.** The research job is a CLI run by hand on the owner's machine:

   ```sh
   npm run research -- --from 2026-10-01 --days 14
   ```

   - It plans the calendar window, finds passages without notes, researches them, pre-validates them with gates 1–3 and repairs them (up to `research.maxRepairs` times).
   - It writes passage files and opens **one PR per passage** through `gh` (`research.prGrouping: 'passage'`), under the owner's account.
   - Those PRs then go through the content gates and the merge rule like any other content PR ([003](003-auto-merge.md)).

2. **CI never runs research.** There is no scheduled or CI research job. CI runs only:
   - PR gates (unit CI and the content gates);
   - the site build and deploy;
   - the runway monitor, which reports how many upcoming days lack notes (`runway.windowDays`, `runway.maxMissingDays`).
3. **Keys.**
   - Research keys (the generator LLM and web search) live only in **local environment variables** on the owner's machine.
   - CI holds only the **verifier-gate LLM secrets** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) and, for the build, the TTS and storage secrets.
   - Every external call goes through a provider interface with a fake (ADR 0005). The research CLI injects the live providers at its entry point (L-038).
4. **Lectionary input.** The planner reads calendar data that is provisional open data, LitCal plus OLM 1981, until a person verifies it against the Kenyan book (owner decision of 2026-10-05, [011](011-lectionary-source.md)).

### Why

- Research is the only expensive, non-repeatable step. Running it locally keeps generator keys and spend under the owner's direct control.
- The site never depends on research being up: pages still show references and link-outs when notes are missing, and the runway monitor warns early.
- A CI schedule stays possible as a fallback (the brief's stall mitigation), but it is out of scope and needs a new owner decision.

## Config keys

All keys live in `config/lectio.config.json` and default in `packages/config/src/defaults.ts` (L-003). `config/README.md` lists them.

| Key                                | Default     | Status                      | Meaning                                                       |
| ---------------------------------- | ----------- | --------------------------- | ------------------------------------------------------------- |
| `research.runner`                  | `local-cli` | Recorded                    | The only allowed value; CI never runs research                |
| `research.defaultDays`             | `14`        | Recorded                    | Window length when `--days` is not given                      |
| `research.prGrouping`              | `passage`   | Recorded                    | One PR per passage                                            |
| `research.maxRepairs`              | `2`         | Default                     | Repair attempts after a failed pre-validation gate            |
| `research.budget.perPassageUsd`    | `1.5`       | Awaiting owner confirmation | Spend ceiling for one passage                                 |
| `research.budget.perRunUsd`        | `25`        | Awaiting owner confirmation | Spend ceiling for one CLI run                                 |
| `research.budget.backfillTotalUsd` | `0`         | Awaiting owner confirmation | Back-fill ceiling. `0` means back-fill runs only as a dry run |

## The online exception

Unit tests are offline (ADR 0005): the root `vitest.setup.ts` msw guard fails any request without a handler, and **unit CI (`ci.yml`) never goes online**.

The one exception is the **content-gates workflow** (`content-gates.yml`, L-031). It is the only workflow that:

- fetches public web pages, for the evidence gate;
- calls the verifier LLMs, with the CI secrets above, and only when they are present (otherwise the verifiers report `skipped` and the PR goes to review).

The research CLI also goes online, but it runs on the owner's machine, not in CI. `npm run test:live` (L-212) runs contract suites against real services locally and is never a required check.

## Open, for owner confirmation

1. **Back-fill budget ceiling.** Default `research.budget.backfillTotalUsd: 0`, so back-fill (L-072) only prints a cost estimate. Per-run `perRunUsd: 25`, per-passage `perPassageUsd: 1.5`. The owner sets a figure after L-041's cost report.
2. **Online exception.** Unit CI stays offline; only the content-gates workflow fetches public web pages and calls the verifier LLMs.

The owner confirms or amends these in a comment on #100. An amendment changes `config/lectio.config.json`, which always needs human review.

## Out of scope

- Scheduled CI research.
- Tuning budgets after the first run (follow-up from L-041, #44).
