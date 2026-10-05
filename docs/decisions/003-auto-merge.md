# 003 · Auto-merge threshold and human approval (L-201, brief decision 3)

- **Status:** Accepted, with items awaiting owner confirmation. The owner recorded the rule on 2026-10-04 ([#100](https://github.com/nyabongo/lectio/issues/100)). The extra needs-review conditions below are defaults until the owner confirms or amends them.
- **Issue:** #100 (roadmap id L-201)
- **Brief question:** "What confidence threshold lets a pull request merge automatically, without a person?"
- **Implemented by:** L-003 (#2, config keys), L-028 (#31, merge-rule decision function), L-031 (#34, content-gates workflow), L-032 (#35, branch protection)
- **Related:** [002 · Human reviewer and weekly capacity](https://github.com/nyabongo/lectio/issues/101) (L-202, open), [004 · Research runner](004-research-runner.md)

## Decision

**A content PR merges automatically only when every deterministic gate passes, both verifiers support every claim at 0.9 or higher, and nothing is refuted. Anything else waits for a person.**

1. **Auto-merge** when all of these hold:
   - every deterministic gate passes (schema, evidence, licence);
   - both verifiers ran (`requireBothVerifiers`), from two different model families;
   - each verifier reports support **≥ 0.9** (`minSupport`) on **every** claim;
   - there are **no** refutations (`maxRefutations: 0`).
2. **Anything else is `needs-review`.** A failed or uncertain check never closes a PR. The research CLI may push a fix to the same PR, and a person settles ties.
3. **Hard rule, not configurable:** a PR that changes `packages/gates/**`, `.github/**` or `config/**` is always `needs-review`, whatever the scores. A PR from a fork is also `needs-review`. Changing config therefore always needs a person, so this rule cannot be switched off from config.

### Human approval

- A person approves a PR with the **`approved` label** or a **`/approve` comment**.
- It counts only when the actor is listed in `config.reviewer.githubHandles` and the approval came **after the last content commit**. A new content commit resets it.
- **The PR author may approve.** The research CLI opens PRs under the owner's own account (see [004](004-research-runner.md)), and GitHub does not let an author approve their own PR review. The label and comment avoid that limit.
- The merge-rule job (L-031) then writes the review block and a signed approval commit from `github-actions[bot]` with the trailer `Lectio-Approval: <human|auto> run=<run id> head=<parent sha>`. L-028 rejects any approval commit that does not meet the validity rule as forged (`blocked`).
- Who the reviewers are and how many PRs they can see each week is decision 2 (L-202, open). Until then the default is `['nyabongo']`.

## Config keys

All keys live in `config/lectio.config.json` and default in `packages/config/src/defaults.ts` (L-003). `config/README.md` lists them.

| Key                                      | Default        | Status                      | Meaning                                                                    |
| ---------------------------------------- | -------------- | --------------------------- | -------------------------------------------------------------------------- |
| `autoMerge.enabled`                      | `true`         | Recorded                    | `false` sends every content PR to review                                   |
| `autoMerge.minSupport`                   | `0.9`          | Recorded                    | Minimum support from each verifier on every claim                          |
| `autoMerge.requireBothVerifiers`         | `true`         | Recorded                    | A skipped verifier means `needs-review`                                    |
| `autoMerge.maxRefutations`               | `0`            | Recorded                    | Any refutation means `needs-review`                                        |
| `autoMerge.sensitiveClaimsRequireReview` | `true`         | Awaiting owner confirmation | A claim flagged sensitive by the generator or either verifier → review     |
| `autoMerge.flagsRequireReview`           | `true`         | Awaiting owner confirmation | Any gate flag (for example a print source or an unfetchable page) → review |
| `autoMerge.passagesOnly`                 | `true`         | Awaiting owner confirmation | A PR that touches files outside `passages/` → review                       |
| `reviewer.githubHandles`                 | `['nyabongo']` | L-202 (open)                | Handles whose label or comment counts as approval                          |
| `reviewer.approvalLabel`                 | `approved`     | Recorded                    | The approval label                                                         |
| `reviewer.approvalCommand`               | `/approve`     | Recorded                    | The approval comment                                                       |

`decide({ results, config, pr })` in `packages/gates/src/merge-rule` (L-028) reads these keys and returns `approved-commit`, `blocked`, `human-approved`, `auto-merge` or `needs-review`. It never returns `close`. `tests/gates/05-merge-rule.gate.test.ts` is the readable decision table.

## Open, for owner confirmation

The recorded rule covers scores and refutations only. Three further conditions are on by default because the brief says that "anything flagged or doctrinally sensitive waits for a human reviewer":

1. **`sensitiveClaimsRequireReview`.** A claim flagged sensitive by the generator (`claims[].sensitive`) or by either verifier goes to review, even with perfect scores.
2. **`flagsRequireReview`.** Any gate flag goes to review, for example a claim that rests on a print source or a page the evidence gate could not fetch.
3. **`passagesOnly`.** Only PRs that touch nothing but `passages/` may auto-merge. Calendar, corpus and other content files go to review.

The owner confirms or amends these in a comment on #100. An amendment changes `config/lectio.config.json`, and that change itself needs human review (hard rule above).

## Code PRs (not content)

The rule above is for content PRs that the content-gates workflow decides. Code and docs PRs, such as the roadmap issues that agents implement, follow a separate owner decision: **a code PR merges only after an agent review and green required CI checks.** An agent never merges its own PR and never changes repository settings or branch protection (CONTRIBUTING.md). L-032 builds branch protection from `.github/required-checks/`.

## Out of scope

- Tuning `minSupport` after the first real run (follow-up from L-041, #44).
- Applying labels, writing review blocks and merging in GitHub (L-031).
