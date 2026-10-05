# Reviewer guide

This guide is for the person who reviews content pull requests: today the owner, and any account listed in
`reviewer.githubHandles` in [`config/lectio.config.json`](../config/lectio.config.json). It covers what to check, what
the labels and the gates comment mean, and how to approve. The gates themselves are described in
[gates.md](gates.md); the rule behind the merge decision is [decision 003](decisions/003-auto-merge.md).

## When a PR needs you

Most content PRs merge on their own: every gate passes and both verifiers support every claim. You are needed when the
merge rule labels a PR **`needs-review`**. Typical reasons:

- a verifier gave a claim low support, refuted it, or gave no verdict;
- a claim is marked sensitive, by the generator or by either verifier;
- a gate flagged something it cannot check, such as a print source or a page it could not fetch;
- the PR is a translation (`passages/i18n/**`), touches files outside `passages/`, or changes `packages/gates/**`,
  `.github/**` or `config/**`;
- the verifier keys were missing, so the verifiers were skipped.

To list them: `gh pr list --repo nyabongo/lectio --label needs-review`. The config sets a weekly capacity
(`reviewer.weeklyCapacity`) and a cap on open review PRs (`reviewer.maxOpenReviewPrs`); the research planner stops
opening PRs once the cap is reached, so the queue stays one you can work through.

## The labels

The merge-rule job keeps exactly one decision label on every content PR, and replaces it on each run:

| Label                  | Meaning                                                                                | What you do                                     |
| ---------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `auto-merge-candidate` | Green: auto-merge, a counted approval, or a valid approval commit. It merges by itself | Nothing. Close the PR or push to it to stop it  |
| `needs-review`         | Waiting for a person (also any green PR that changes `.github/**`)                     | Review it (below)                               |
| `gates-failed`         | Blocked: a deterministic gate failed, or a forged approval or hand-set review block    | Nothing until the author or fix-up pushes a fix |

You add one label yourself: **`approved`**, to approve (below). The `merge-rule` check on the PR is green for
`auto-merge-candidate` and red otherwise; it is a required check, so a red one keeps the merge button closed.

## Reading the gates comment

The merge-rule job keeps one comment on the PR, written by `github-actions[bot]` and updated on every run. Read it
from the top:

1. **The headline and the gates table.** One row per gate (schema, evidence, licence, verifiers): `Pass`, `Fail`,
   `Needs review` or `Skipped`, with a count of findings. `Needs review` means the gate flagged something (a warning);
   `Fail` means an error; a note (`info`) never changes a decision.
2. **Findings**, grouped by file and then by claim (`Claim c2`), errors first. Each finding names its rule (for example
   `verifiers/claim-supported`), the gate, the place in the file as a JSON pointer (`/claims/1` is the second claim,
   `/sources/2` the third source), what was found, and then the rule's statement and its fix. For a verifier finding
   the message shows both verdicts and support scores, and the rationale of the doubtful one, in quotes. Rule ids are
   listed with their fixes in [gates.md](gates.md#rules-by-gate).
3. **The licence limitation note.** Every run repeats it as an `info` finding: the Bible-overlap check only sees
   public-domain wording, so a copied run from a modern copyrighted translation can slip through. That is one of the
   things you check by eye.
4. **The footer**: the base, the head and the number of changed files.
5. **`Merge rule: <decision>`** and its reasons, one per line, for example
   `claim c2 (passages/…json): refuter support 0.78 is below 0.9`. These are the reasons the PR is waiting for you.
6. **`Checked head:`** with the full commit sha. If it is not the PR's latest commit, the gates are still running on
   the new head: wait for the comment to update.

[gates.md](gates.md#the-gates-comment) shows a full sample comment, rendered by the real merge rule. When a comment
says findings were left out for its size, download the run's `gates-report` artifact for the full list
(`gh run download <run id> -n gates-report`).

## What to check

Open the passage file (**Files changed**), with the gates comment beside it. The gates have already checked the
structure, that every sentence is cited, that the cited evidence exists, and that nothing long is copied. Your job is
the judgement they cannot make:

- **Sources.** Each claim says what its sources say, not more. Open the cited pages for the claims the comment flags,
  and for any claim that surprises you. A print source cannot be checked automatically: check the citation is real
  and plausible, and prefer a checkable web or scripture source where one exists. Sources should be reputable
  (scholarly commentaries, standard lexicons, Church documents), not anonymous pages.
- **Sensitivity.** Read every claim marked sensitive, and anything touching doctrine, morals, the sacraments, other
  Christian traditions or other faiths, or a contested historical question. It must be accurate, fair and sourced. A
  sensitive-claim flag is never "fixed" by a tool: it is yours to judge.
- **Tone.** Plain, warm and modest: it explains, it does not preach or argue. No polemics, no speculation presented as
  fact, no devotional claims the sources do not make.
- **A study aid, not Church teaching.** Notes help a reader understand the readings: their history, their original
  words. They never present themselves as the Church's teaching, give pastoral or moral direction, or settle questions
  the Church leaves open. Where a note reports an interpretation, it names whose it is.
- **No reading text.** Lectio never carries the text of the readings ([ADR 0003](adr/0003-never-store-reading-text.md)).
  Quoted English stays short (the licence guard limits it), and nothing should read like a paraphrase of a modern
  translation.
- **Translations** (`passages/i18n/<locale>/`) always need a person. Check the translation says what the English
  says, in natural language, with the same claims and `[cN]` markers as the English file.

## Approving

When the passage is right, approve it in one of two ways:

- add the **`approved` label** to the PR, or
- comment **`/approve`** as the first line of a new comment.

It counts only when your handle is in `reviewer.githubHandles` and you approve **after the last content commit**. A
new content commit (a fix-up, or your own edit) resets it, so approve again after it. Removing the label revokes a
label approval, and an edited comment never counts: post a new one instead.

The rest is automatic. The trusted content-gates workflow sees the label or the comment, decides `human-approved`,
writes the review block (`status: approved`, `method: human`, your handle, `approvedVia: label` or `comment`) in an
approval commit signed by `github-actions[bot]`, runs the required checks on that commit and squash-merges. You do not
press the merge button. Two kinds of PR are merged by hand after approval: a PR that changes `.github/**`, and a PR
from a fork.

**Why you may approve your own PR.** The research CLI opens PRs under the owner's account, and GitHub never lets the
author of a PR approve it in a PR review. The label and the comment are Lectio's own approval channels, checked against
`reviewer.githubHandles`, so the author may use them ([decision 003](decisions/003-auto-merge.md#human-approval)). The
safeguard is the review itself, not who opened the PR.

**Approving locally.** `npm run review:approve -- passages/<KEY>.json --reviewer <handle>` writes the same review block
on your checkout (`approvedVia: cli`), for example when you edit and review a file on its branch yourself. A local
approval is not a PR approval: the merge rule blocks a PR that sets a review block to approved without a counted
label, comment or approval commit. On a PR, use the label or `/approve`.

## When it is not right

- **A small fix**: run `npm run research -- fixup --pr <n> --budget 3`. It repairs the findings in the latest gates
  comment and pushes a commit; the gates run again. See the [research runbook](runbooks/research-cli.md#fix-up-mode).
- **An edit you can make**: edit the file on the PR branch and push. The gates run again; approve once they have.
- **A wrong passage**: close the PR. A closed PR blocks that passage key for good: the planner skips it.
- **Stopping a PR already approved**: removing the label or deleting the comment after the approval commit was written
  does not stop the merge. Close the PR, or push to it.

## Quick reference

| You want to             | Do                                                                    |
| ----------------------- | --------------------------------------------------------------------- |
| See what waits for you  | `gh pr list --repo nyabongo/lectio --label needs-review`              |
| Approve                 | Add the `approved` label, or comment `/approve`                       |
| Approve again after fix | Same, after the last content commit                                   |
| Repair a flagged claim  | `npm run research -- fixup --pr <n> --budget 3`                       |
| Reject                  | Close the PR                                                          |
| See every finding       | `gh run download <run id> -n gates-report`                            |
| Look up a rule          | [gates.md, rules by gate](gates.md#rules-by-gate)                     |
| Re-run the gates        | Push a commit, or re-run the Content checks workflow from the Actions |
