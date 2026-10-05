/**
 * Publishing translations: one pull request per locale and passage, on `translate/<locale>/<key>`,
 * through the `GitHubClient` interface (so GitHub signs the commit).
 *
 * Every translation PR carries the `translation` and `needs-review` labels: translations never
 * auto-merge. Gate 1 enforces the same rule (`schema/translation-needs-review` flags every pending
 * translation, and the translated-passage schema has no auto approval).
 *
 * Re-running updates an open PR in place (a new commit only when the file changed; the gate
 * section between the `lectio-gates` markers is kept). Like research publishing, it refuses when
 * a person closed the PR, when the branch exists without an open PR, or when the open PR's head is
 * not a translation commit for this file.
 */
import { ProviderError } from '@lectio/providers';
import type { FileChange, GitCommit, GitHubClient, PullRequest } from '@lectio/providers';
import { translatedPassagePath } from '@lectio/schema/translated-passage';
import type { TranslatedPassage } from '@lectio/schema/translated-passage';

import { NEEDS_REVIEW_LABEL } from '../plan/plan.ts';
import { GATES_END, GATES_START, code, inline, keepGates } from '../publish/body.ts';
import { formatJson } from '../publish/format-json.ts';
import { languageName } from './translate.ts';
import { translationBranch } from './plan.ts';

/** Label on every translation PR, next to `needs-review`. */
export const TRANSLATION_LABEL = 'translation';

/** Trailer on every translation commit: `Lectio-Translation: key=<key> locale=<locale> source=<sha256> run=<run id>`. */
export const TRANSLATION_TRAILER = 'Lectio-Translation';

export interface TranslationPublishItem {
  readonly translation: TranslatedPassage;
  /** The passage's calendar dates in the run's window. */
  readonly dates?: readonly string[];
}

export interface TranslationPublishOptions {
  readonly github: Pick<GitHubClient, 'listPrs' | 'createBranch' | 'commitFiles' | 'getCommit' | 'openOrUpdatePr'>;
  /** Base branch of new PRs and branches. Default: the repository's default branch. */
  readonly base?: string;
}

export interface TranslationPublishResult {
  readonly key: string;
  readonly locale: string;
  readonly branch: string;
  readonly pr: PullRequest;
  readonly created: boolean;
  /** The commit this run pushed, or `null` when the open PR already had this file. */
  readonly commit: GitCommit | null;
  readonly path: string;
}

export type TranslationRefusal = 'leftover-branch' | 'closed-pr' | 'foreign-head';

export class TranslationPublishRefusedError extends Error {
  override readonly name = 'TranslationPublishRefusedError';
  readonly reason: TranslationRefusal;
  readonly branch: string;

  constructor(reason: TranslationRefusal, message: string, branch: string) {
    super(message);
    this.reason = reason;
    this.branch = branch;
  }
}

function trailerPrefix(translation: TranslatedPassage): string {
  return `${TRANSLATION_TRAILER}: key=${translation.translationOf} locale=${translation.locale} `;
}

/** PR title of a translation. */
export function translationPrTitle(translation: TranslatedPassage): string {
  return `Translate ${translation.translationOf} into ${translation.locale}`;
}

/** Commit message of a translation, with the attribution trailer. */
export function translationCommitMessage(translation: TranslatedPassage): string {
  const { provenance } = translation;
  return [
    `translate(${translation.locale}): ${translation.translationOf}`,
    '',
    `${trailerPrefix(translation)}source=${translation.sourceSha256} run=${provenance.runId}`,
  ].join('\n');
}

/** PR body: what was translated from what, and that a person must approve it. */
export function translationPrBody(translation: TranslatedPassage, path: string, dates: readonly string[]): string {
  const { provenance } = translation;
  return [
    `Translation of the commentary for ${code(translation.translationOf)} into ${inline(languageName(translation.locale))}.`,
    '',
    `| | |`,
    `| --- | --- |`,
    `| File | ${code(path, true)} |`,
    `| English source hash | ${code(translation.sourceSha256, true)} |`,
    `| Read on | ${dates.length === 0 ? 'not in this window' : dates.join(', ')} |`,
    `| Notes / claims | ${String(translation.translationNotes.length)} / ${String(translation.claims.length)} |`,
    `| Models | ${provenance.models.length === 0 ? 'none' : provenance.models.map((model) => code(model, true)).join(', ')} |`,
    `| Prompt | ${code(provenance.promptVersion, true)} |`,
    `| Cost | ${provenance.costUsd === undefined ? 'unknown' : `$${provenance.costUsd.toFixed(2)}`} |`,
    '',
    '**Translations never auto-merge.** A configured reviewer who reads the language checks that the translation says',
    'what the English says, keeps every claim marker, and quotes no Bible translation, then approves it.',
    '',
    GATES_START,
    '_Gate results appear here._',
    GATES_END,
  ].join('\n');
}

/** Whether a translation commit may go on top of `head`: only an earlier translation of the same file. */
export function isTranslationHead(head: Pick<GitCommit, 'message'>, translation: TranslatedPassage): boolean {
  return head.message.split('\n').some((line) => line.startsWith(trailerPrefix(translation)));
}

/** The source hash and run recorded by `head`, to tell whether the file changed. */
function sameFile(head: Pick<GitCommit, 'message'>, translation: TranslatedPassage): boolean {
  const { provenance } = translation;
  return head.message
    .split('\n')
    .includes(`${trailerPrefix(translation)}source=${translation.sourceSha256} run=${provenance.runId}`);
}

/** Publishes one translation: commit on `translate/<locale>/<key>`, then open or update its PR. */
export async function publishTranslation(
  item: TranslationPublishItem,
  options: TranslationPublishOptions,
): Promise<TranslationPublishResult> {
  const { github, base } = options;
  const { translation } = item;
  if (translation.review.status !== 'pending') {
    throw new RangeError('translations are published pending review only');
  }
  const branch = translationBranch(translation.locale, translation.translationOf);
  const path = translatedPassagePath(translation.locale, translation.translationOf);
  const files: FileChange[] = [{ path, content: formatJson(translation) }];

  const prs = (await github.listPrs({ state: 'all', head: branch })).filter((pr) => !pr.fork && pr.head === branch);
  const open = prs.find((pr) => pr.state === 'open');
  let commit: GitCommit | null = null;
  if (open === undefined) {
    if (prs.some((pr) => pr.state === 'closed')) {
      throw new TranslationPublishRefusedError(
        'closed-pr',
        `a translation PR on ${branch} was closed without merging; translate does not re-open it`,
        branch,
      );
    }
    try {
      await github.createBranch(base === undefined ? { name: branch } : { name: branch, from: base });
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'conflict') {
        throw new TranslationPublishRefusedError(
          'leftover-branch',
          `branch ${branch} exists without an open PR; delete it to translate this passage again`,
          branch,
        );
      }
      throw error;
    }
    commit = await github.commitFiles({ branch, message: translationCommitMessage(translation), files });
  } else {
    const head = await github.getCommit(open.headSha);
    if (!isTranslationHead(head, translation)) {
      throw new TranslationPublishRefusedError(
        'foreign-head',
        `PR #${String(open.number)} head ${open.headSha.slice(0, 12)} is not a translation commit; someone else changed the branch`,
        branch,
      );
    }
    if (!sameFile(head, translation)) {
      commit = await github.commitFiles({
        branch,
        message: translationCommitMessage(translation),
        files,
        expectedHeadSha: open.headSha,
      });
    }
  }

  const body = translationPrBody(translation, path, item.dates ?? []);
  const { pr, created } = await github.openOrUpdatePr({
    head: branch,
    ...(base === undefined ? {} : { base }),
    title: translationPrTitle(translation),
    body: open === undefined ? body : keepGates(body, open.body),
    labels: [TRANSLATION_LABEL, NEEDS_REVIEW_LABEL],
  });
  return { key: translation.translationOf, locale: translation.locale, branch, pr, created, commit, path };
}
