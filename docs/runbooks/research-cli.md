# Runbook: the research CLI

Research runs on the owner's machine, never in CI ([decision 004](../decisions/004-research-runner.md)). The CLI plans
the calendar window, researches each passage that has no notes yet, checks it with gates 1–3 (repairing it when they
fail), and opens one pull request per passage. The content gates and the merge rule then take over
([decision 003](../decisions/003-auto-merge.md)).

```sh
npm run research -- [run] --from 2026-10-01 --days 14 --budget 20   # research and open PRs
npm run research -- plan --from 2026-10-01 --days 14                # what a run would do; spends nothing
npm run research -- fixup --pr 123 --budget 3                       # repair an open research PR after its gates
npm run research -- translate --locale sw --days 14 --budget 5      # translations of approved passages (L-112)
npm run research -- help
```

Flags every subcommand takes:

| Flag                    | Default | Meaning                                                                               |
| ----------------------- | ------- | ------------------------------------------------------------------------------------- |
| `--provider live\|fake` | `live`  | `live` uses Anthropic, `gh` and the web; `fake` uses the deterministic fakes, offline |
| `--dry-run`             | off     | Research and validate, but write nothing to GitHub. Always on with `--provider fake`  |
| `--budget <usd>`        | `0`     | The run's spend ceiling. A live run refuses to start without it (see [Costs](#costs)) |

`run` and `plan` also take `--from YYYY-MM-DD` (default today in `site.timezone`), `--days n` (default
`research.defaultDays`, 14), `--only <passage key>` and `--max n`. `fixup` takes `--pr <n>`, `--force` and
`--report <gates.json>`. Exit codes: `0` done, `1` something needs your attention, `2` a bad command line.

## Prerequisites

1. **A clone of the repository** on an up-to-date `main`, with `npm ci` done. Run the CLI from anywhere inside it.
2. **The GitHub CLI, logged in** as the account that should open the PRs: `gh auth login`, then `gh auth status`. The
   CLI asks `gh` who you are before it starts and stops with a clear message when it cannot tell.
3. **`ANTHROPIC_API_KEY`** exported in the shell that runs research (for example from an untracked `.env` loaded by
   direnv). Never commit it. A live `run`, `fixup` or `translate` without it stops; it never falls back to a fake.
   `plan` needs no key.
4. **The research models are Anthropic models** (`research.models.*` in `config/lectio.config.json`). Another family
   is refused: only the Anthropic provider is wired for research.

Nothing else is needed: web search and web fetch run on Anthropic's side, and the evidence gate fetches sources
directly (cached under `.cache/sources/`).

## The weekly routine

Once a week, research the next 14 days so the site always has notes ahead of the calendar:

1. `git switch main && git pull && npm ci`
2. `npm run research -- plan --from <today> --days 14` and read the plan: what it will research, what it skips
   (passage already in the repo, an open PR, a PR a person closed) and which cap limits it (reviewer capacity, weekly
   intake, budget, `--max`).
3. `npm run research -- --from <today> --days 14 --budget <usd>`. The run ends with a table, one row per passage:

   ```text
   Passage      Research  Validation  Cost   PR
   -----------  --------  ----------  -----  ------------------------------------------
   LK.10.25-37  written   ready       $0.62  https://github.com/nyabongo/lectio/pull/301
   GAL.1.6-12   written   abandoned   $1.48  abandoned
   Spent $2.10 of the $20.00 run budget. 1 passage(s) need attention.
   ```

   Above the table, the pre-validation section lists each repair and, for an abandoned passage, the problems that
   remain. Raw drafts stay in `.cache/research/<run id>/` (git-ignored); your checkout is never changed, because the
   validated file is committed through the GitHub API.

4. Watch the PRs. The content gates run on each one; most merge on their own, the rest get `needs-review`.

A passage that was abandoned or ran over its budget is simply planned again next time. To try one passage again at
once, run with `--only <key>`.

## Approving a PR

A PR that the merge rule sends to review waits for you:

- Read the passage file and the gates comment, then approve with the **`approved` label** or a **`/approve`
  comment**. Only accounts in `reviewer.githubHandles` count, and only after the last content commit; you may approve
  your own research PR this way.
- The merge-rule job then writes the review block in a signed approval commit and merges.
- To reject a passage, **close** the PR. Research never re-opens it and the planner skips the key (`run` reports
  "a person closed PR #n"). To research it again, delete the `research/<key>` branch first.

## Fix-up mode

When the gates find something a repair can fix (a verifier refuted a claim, or gave it low support), run:

```sh
npm run research -- fixup --pr <n> --budget 3
```

It reads the **latest gates comment written by `github-actions[bot]`** (comments by anyone else are ignored, so text
pasted into a PR never reaches the model), passes the verifier findings for that passage to the repair loop with
gates 1–3, and pushes the result as a new commit on the same branch. The gates then run again. It never closes the PR.

- It refuses a closed or fork PR, a branch that is not `research/<key>`, and a branch someone else pushed to.
- It refuses a PR you already approved, because the new commit resets the approval; `--force` overrides.
- It refuses a gates comment written for an older head (wait for the gates to finish); `--force` overrides.
- When the comment says findings were left out for its size, download the content-gates run's `gates.json` artifact
  (`gh run download <run id>`) and pass it with `--report <path>/gates.json`.
- A sensitive-claim flag is never "fixed": it is for a person to judge.

## Costs

- **Per run:** `--budget <usd>`, at most `research.budget.perRunUsd` ($25 by default). Live research is $0 until you
  pass it: a live run without `--budget` stops before any call. Raising the ceiling above `perRunUsd` means changing
  `config/lectio.config.json`, which always goes through review.
- **Per passage:** `research.budget.perPassageUsd` ($1.50 by default) covers research and repairs together. A passage
  that hits it stops cleanly; nothing is written and the run goes on.
- The planner divides the run budget by the per-passage estimate, so a run never plans more than it can pay for.
- A fix-up is one passage: it spends at most `perPassageUsd` and at most `--budget`.
- Fake runs cost nothing; their meter uses `--budget` (or `perRunUsd`) so the output looks like a live run.

## Troubleshooting

| Message                                                          | What to do                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `live research spends real money and this run's budget is $0`    | Pass `--budget <usd>`, or use `--provider fake` to try the pipeline           |
| `--budget $… is above research.budget.perRunUsd`                 | Use a smaller budget, or raise `perRunUsd` in a config PR                     |
| `ANTHROPIC_API_KEY is not set`                                   | Export the key in this shell                                                  |
| `gh could not tell who you are`                                  | `gh auth login`, then `gh auth status`                                        |
| `research.models.… is a openai model`                            | Point `research.models` at Anthropic models                                   |
| A passage `abandoned`                                            | Read its problems in the pre-validation section; it is planned again next run |
| `not published: branch research/<key> exists without an open PR` | A leftover branch: delete it on GitHub to research the passage again          |
| `not published: … was closed without merging`                    | A person rejected the passage; delete the branch to try again                 |
| `has no gates comment from github-actions[bot] yet`              | Wait for the content-gates workflow to finish on the PR                       |
| `is already approved`                                            | Leave it, or pass `--force` if the fix is worth a new review                  |
| `--provider fake: dry run` and every passage `abandoned`         | Expected: fake output carries fake provenance, which gate 1 rejects           |

Translations (`translate`) follow the same flags and budget rules; see [L-112](https://github.com/nyabongo/lectio/issues/200)
for what they produce. CI never runs any of this, and there is no scheduled research job.
