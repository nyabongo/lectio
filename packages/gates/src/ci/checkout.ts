/**
 * The PR head as data: the commits fetched into the `pr-head/` worktree next to the tooling
 * checkout (main). Files are read as git blobs at the head commit, never through the worktree, and
 * only regular files (modes 100644 and 100755): a symbolic link or a submodule reads as absent,
 * whatever it points to. Nothing in the PR is installed, imported or run, so a PR that edits the
 * gates or `decide` cannot change its own decision.
 */
import { createGit, nodeGitExec, nonRegularFiles } from '../core/git.ts';
import type { ChangedFile, GitExec } from '../core/git.ts';

/** One commit of `base..head` with its parents (`git rev-list --parents`). */
export interface CommitLink {
  readonly sha: string;
  readonly parents: readonly string[];
}

export interface PrCheckout {
  /** Files changed between the merge base of `base` and `head`, and `head`. */
  changedFiles(base: string, head: string): ChangedFile[];
  /** Changed paths that are not regular files at `head` (symbolic links, submodules). */
  nonRegular(base: string, head: string): string[];
  /** The text of a regular file `path` at `ref`, or `null` when it is absent or not a regular file. */
  show(ref: string, path: string): string | null;
  /** The commits in `base..head` (reachable from `head`, not from `base`) with their parents. */
  revList(base: string, head: string): CommitLink[];
  /** {@link show} at the PR head this checkout was opened on. */
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

const REGULAR = /^100(644|755) blob ([0-9a-f]+)\t/;

/** A {@link PrCheckout} over the repository at `root`, reading files at commit `head`. */
export function gitCheckout(root: string, head: string, exec: GitExec = nodeGitExec): PrCheckout {
  const git = createGit(root, exec);
  const show = (ref: string, path: string): string | null => {
    const entry = REGULAR.exec(exec(['ls-tree', ref, '--', path], root));
    return entry === null ? null : exec(['cat-file', 'blob', entry[2] as string], root);
  };
  return {
    changedFiles: (base, to) => git.changedFiles(base, to),
    nonRegular: (base, to) => nonRegularFiles(exec, root, base, to),
    show,
    revList: (base, to) => parseRevList(exec(['rev-list', '--parents', `${base}..${to}`], root)),
    readFile: (path) => show(head, path),
  };
}
