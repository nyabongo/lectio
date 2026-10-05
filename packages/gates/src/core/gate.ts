/**
 * The `Gate` interface and the context every gate receives.
 *
 * A gate is a named, self-explaining test over a pull request: it declares its rules and returns
 * one {@link GateResult}. The context carries what it may look at: the files the PR changes
 * (`git diff base...head`), the content repository at the PR head (L-018), the config (L-003),
 * the providers (L-008) and the results of the gates that ran before it in this run.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import { openRepo } from '@lectio/content';
import type { ContentRepo } from '@lectio/content';
import type { ProviderSet } from '@lectio/providers';

import type { ChangedFile, Git } from './git.ts';
import type { GateResult } from './result.ts';
import type { Rule } from './rules.ts';

export interface GateContext {
  /** Absolute path of the checked-out PR head (repository root). */
  readonly root: string;
  /** The ref the PR merges into, e.g. `origin/main`. */
  readonly base: string;
  /**
   * The PR head ref, e.g. `HEAD`. It must be the commit checked out at `root`: `changedFiles`
   * diffs `base...head`, while `readFile` and `repo` read the working tree under `root`
   * (`lectio-gates run` refuses a `--head` that is not checked out there; `checkedOutAt`).
   */
  readonly head: string;
  /** Every file the PR changes, sorted by path, deletions included. */
  readonly changedFiles: readonly ChangedFile[];
  readonly config: LectioConfig;
  readonly providers: ProviderSet;
  /** The content repository at the PR head (`config.content.root` under `root`). */
  readonly repo: ContentRepo;
  readonly git: Git;
  /** A repository-relative file at the PR head, or `null` when it does not exist. */
  readFile(path: string): string | null;
  /** A repository-relative file on the base branch, or `null` when it did not exist there. */
  readBase(path: string): string | null;
  /** Results of the gates that already ran in this run, in order. */
  readonly results: readonly GateResult[];
}

export interface Gate {
  /** Gate slug, also the prefix of its rule ids: `schema`, `evidence`, `licence`, `verifiers`, `merge-rule`. */
  readonly id: string;
  /** Human title, used as the heading in the PR comment. */
  readonly title: string;
  /** Every rule the gate can report. */
  readonly rules: readonly Rule[];
  run(context: GateContext): GateResult | Promise<GateResult>;
}

/** File access for {@link createContext}; tests inject their own. */
export type ReadText = (absolutePath: string) => string | null;

export const nodeReadText: ReadText = (absolutePath) => {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
};

/**
 * A {@link ReadText} for files under `root` that never follows a symbolic link: every path
 * component from `root` down is checked with `lstat`, and a link or a non-regular file throws
 * (the gate then fails). A missing file is `null`. For PR content read from a worktree.
 */
export function noFollowReadText(root: string, fs: NoFollowFs = nodeNoFollowFs): ReadText {
  const base = resolve(root);
  return (absolutePath) => {
    const target = resolve(absolutePath);
    const rel = relative(base, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${absolutePath} is outside ${base}`);
    let current = base;
    const parts = rel.split(sep);
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      const kind = fs.kind(current);
      if (kind === 'missing') return null;
      if (kind === 'link') throw new Error(`${rel} is a symbolic link; the gates never follow links`);
      const last = index === parts.length - 1;
      if (last && kind !== 'file') throw new Error(`${rel} is not a regular file`);
      if (!last && kind !== 'dir') return null;
    }
    return fs.read(target);
  };
}

/** What {@link noFollowReadText} needs from the file system. */
export interface NoFollowFs {
  /** The entry at `path` without following links. */
  kind(path: string): 'file' | 'dir' | 'link' | 'other' | 'missing';
  read(path: string): string;
}

export const nodeNoFollowFs: NoFollowFs = {
  kind(path) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if ((error as { code?: unknown }).code === 'ENOENT') return 'missing';
      throw error;
    }
    if (stat.isSymbolicLink()) return 'link';
    if (stat.isDirectory()) return 'dir';
    return stat.isFile() ? 'file' : 'other';
  },
  read: (path) => readFileSync(path, 'utf8'),
};

export interface CreateContextOptions {
  readonly root: string;
  readonly base: string;
  readonly head: string;
  readonly config: LectioConfig;
  readonly providers: ProviderSet;
  readonly git: Git;
  /** Defaults to `openRepo(join(root, config.content.root))`. */
  readonly repo?: ContentRepo;
  /** Defaults to Node's `fs`. */
  readonly readText?: ReadText;
}

/** The context for one run, without prior results (the runner adds them per gate). */
export function createContext(options: CreateContextOptions): GateContext {
  const { root, base, head, config, providers, git } = options;
  const readText = options.readText ?? nodeReadText;
  return {
    root,
    base,
    head,
    changedFiles: git.changedFiles(base, head),
    config,
    providers,
    repo: options.repo ?? openRepo(join(root, config.content.root)),
    git,
    readFile: (path) => readText(join(root, path)),
    readBase: (path) => git.show(base, path),
    results: [],
  };
}
