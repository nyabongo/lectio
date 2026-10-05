/**
 * The two git questions the gates ask: which files a pull request changes
 * (`git diff base...head`), and what a file looked like on the base branch (`git show`). Git is a
 * local process, not a network service, but it is still injected (`GitExec`) so unit tests can
 * answer for it.
 */
import { execFileSync } from 'node:child_process';

/** Runs `git <args>` in `cwd` and returns stdout; throws when git exits non-zero. */
export type GitExec = (args: readonly string[], cwd: string) => string;

export const nodeGitExec: GitExec = (args, cwd) =>
  execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'unmerged';

export interface ChangedFile {
  /** Repository-relative path with forward slashes (the new path for a rename or copy). */
  readonly path: string;
  readonly status: ChangeStatus;
  /** The old path of a rename or copy. */
  readonly previousPath?: string;
}

export interface Git {
  /** Files changed between the merge base of `base` and `head`, and `head` (`git diff base...head`). */
  changedFiles(base: string, head: string): ChangedFile[];
  /** The text of `path` at `ref`, or `null` when the file does not exist there. */
  show(ref: string, path: string): string | null;
}

const STATUS: Readonly<Record<string, ChangeStatus>> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
  U: 'unmerged',
};

/** Parses `git diff --name-status -z` output. */
export function parseNameStatus(output: string): ChangedFile[] {
  const tokens = output.split('\0');
  const files: ChangedFile[] = [];
  for (let code = tokens.shift(); code !== undefined; code = tokens.shift()) {
    if (code === '') continue;
    const status = STATUS[code.charAt(0)];
    if (status === undefined) throw new Error(`unexpected git diff status "${code}"`);
    if (status === 'renamed' || status === 'copied') {
      const previousPath = tokens.shift() ?? '';
      files.push({ path: tokens.shift() ?? '', status, previousPath });
    } else {
      files.push({ path: tokens.shift() ?? '', status });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const REGULAR_MODES: ReadonlySet<string> = new Set(['100644', '100755']);

/**
 * Paths that `head` adds or changes as something other than a regular file (a symbolic link,
 * mode 120000, or a submodule, 160000), from `git diff --raw -z` output. Deletions do not count.
 */
export function parseNonRegular(output: string): string[] {
  const tokens = output.split('\0');
  const found: string[] = [];
  for (let meta = tokens.shift(); meta !== undefined; meta = tokens.shift()) {
    if (!meta.startsWith(':')) continue;
    const [, newMode = '', , , status = ''] = meta.slice(1).split(' ');
    if (status.startsWith('R') || status.startsWith('C')) tokens.shift();
    const path = tokens.shift() ?? '';
    if (!status.startsWith('D') && !REGULAR_MODES.has(newMode)) found.push(path);
  }
  return found.sort();
}

/** {@link parseNonRegular} for `base...head` in the repository at `cwd`. */
export function nonRegularFiles(exec: GitExec, cwd: string, base: string, head: string): string[] {
  return parseNonRegular(exec(['diff', '--raw', '-z', '--no-abbrev', `${base}...${head}`], cwd));
}

/** A {@link Git} for the repository at `cwd`. */
export function createGit(cwd: string, exec: GitExec = nodeGitExec): Git {
  return {
    changedFiles: (base, head) => parseNameStatus(exec(['diff', '--name-status', '-z', `${base}...${head}`], cwd)),
    show(ref, path) {
      const listed = exec(['ls-tree', '--name-only', ref, '--', path], cwd);
      if (listed.trim() === '') return null;
      return exec(['show', `${ref}:${path}`], cwd);
    },
  };
}

/**
 * `true` when `ref` names the commit checked out at `cwd`. Gates read the working tree (the
 * content repo and `readFile`), so a run is only coherent when `--head` is that checkout.
 */
export function checkedOutAt(exec: GitExec, cwd: string, ref: string): boolean {
  if (ref === 'HEAD') return true;
  const commit = (name: string): string => exec(['rev-parse', '--verify', '--quiet', `${name}^{commit}`], cwd).trim();
  try {
    return commit(ref) === commit('HEAD');
  } catch {
    return false;
  }
}
