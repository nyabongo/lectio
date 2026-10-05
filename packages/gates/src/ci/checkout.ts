/**
 * The PR head as data: the `pr-head/` worktree the content-gates jobs fetch next to the tooling
 * checkout (main). Jobs read files and history from it; nothing in it is installed, imported or
 * run, so a PR that edits the gates or `decide` cannot change its own decision.
 */
import { join } from 'node:path';

import { nodeReadText } from '../core/gate.ts';
import { createGit, nodeGitExec } from '../core/git.ts';
import type { ChangedFile, GitExec } from '../core/git.ts';

/** One commit of `base..head` with its parents (`git rev-list --parents`). */
export interface CommitLink {
  readonly sha: string;
  readonly parents: readonly string[];
}

export interface PrCheckout {
  /** Files changed between the merge base of `base` and `head`, and `head`. */
  changedFiles(base: string, head: string): ChangedFile[];
  /** The text of `path` at `ref`, or `null` when it does not exist there. */
  show(ref: string, path: string): string | null;
  /** The commits in `base..head` (reachable from `head`, not from `base`) with their parents. */
  revList(base: string, head: string): CommitLink[];
  /** A repository-relative file in the checked-out PR head, or `null` when it does not exist. */
  readFile(path: string): string | null;
}

/** Parses `git rev-list --parents` output: one `<sha> <parent>…` line per commit. */
export function parseRevList(output: string): CommitLink[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [sha, ...parents] = line.split(/\s+/) as [string, ...string[]];
      return { sha, parents };
    });
}

/** A {@link PrCheckout} over the worktree at `root`. */
export function gitCheckout(root: string, exec: GitExec = nodeGitExec): PrCheckout {
  const git = createGit(root, exec);
  return {
    changedFiles: (base, head) => git.changedFiles(base, head),
    show: (ref, path) => git.show(ref, path),
    revList: (base, head) => parseRevList(exec(['rev-list', '--parents', `${base}..${head}`], root)),
    readFile: (path) => nodeReadText(join(root, path)),
  };
}
