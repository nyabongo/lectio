/**
 * The `Gate` interface and the context every gate receives.
 *
 * A gate is a named, self-explaining test over a pull request: it declares its rules and returns
 * one {@link GateResult}. The context carries what it may look at: the files the PR changes
 * (`git diff base...head`), the content repository at the PR head (L-018), the config (L-003),
 * the providers (L-008) and the results of the gates that ran before it in this run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
