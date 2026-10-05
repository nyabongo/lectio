/**
 * Reading a PR's files through the local checkout: `git fetch origin <branch>`, then `git show`.
 * The `GitHubClient` interface commits files but does not read them, and the owner runs the CLI
 * from a clone of the repository, so git answers.
 */
import { createGit, nodeGitExec } from '@lectio/gates';
import type { GitExec } from '@lectio/gates';

import type { PrFiles } from './fixup.ts';

/** {@link PrFiles} on the git checkout at `root`. */
export function gitPrFiles(root: string, exec: GitExec = nodeGitExec): PrFiles {
  const git = createGit(root, exec);
  const fetch = (branch: string): void => {
    exec(['fetch', '--quiet', 'origin', `refs/heads/${branch}`], root);
  };
  return {
    head(pr, path) {
      fetch(pr.head);
      return Promise.resolve(git.show(pr.headSha, path));
    },
    base(pr, path) {
      fetch(pr.base);
      return Promise.resolve(git.show('FETCH_HEAD', path));
    },
  };
}
