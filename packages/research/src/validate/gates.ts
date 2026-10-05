/**
 * Runs the deterministic gates (1 schema, 2 evidence, 3 licence) in-process on one draft passage,
 * the way the content-gates workflow will run them on its pull request.
 *
 * The draft never touches the disk: the gate context reads it from memory as the one file the
 * "pull request" adds (or modifies, when `readBase` knows a base-branch version). Everything else
 * (the corpus, the licence guard index) is read under `root`, the repository checkout.
 */
import { join } from 'node:path';

import type { LectioConfig } from '@lectio/config';
import type { ContentRepo } from '@lectio/content';
import { createContext, formatFinding, nodeReadText, ruleBookFor, runGates, selectGates } from '@lectio/gates';
import type { ChangedFile, Gate, GateReport, GateResultItem, ReadText } from '@lectio/gates';
import type { ProviderSet } from '@lectio/providers';

/** Ids of the gates the research CLI runs before it opens a pull request. The verifiers run in CI. */
export const PRE_VALIDATION_GATE_IDS = ['schema', 'evidence', 'licence'] as const;

/** Gates 1–3 from the gates registry, in run order. */
export function preValidationGates(): Gate[] {
  return selectGates(PRE_VALIDATION_GATE_IDS);
}

export interface DraftGateDeps {
  readonly config: LectioConfig;
  /** The fetcher the evidence and licence gates use for web sources. */
  readonly providers: ProviderSet;
  /** Repository root: the corpus and the licence guard index are read under it. */
  readonly root: string;
  /** Defaults to the gates' `openRepo` of the content root. */
  readonly repo?: ContentRepo;
  /** Reads every file other than the draft. Default node:fs. */
  readonly readText?: ReadText;
  /**
   * The base-branch text of a repository-relative path, or `null` when the passage is new.
   * Default: always new. With a base version the schema gate also checks that no note or claim id
   * was dropped.
   */
  readonly readBase?: (path: string) => string | null;
  /** The gates to run; default {@link preValidationGates}. */
  readonly gates?: readonly Gate[];
}

export interface DraftGateRun {
  readonly report: GateReport;
  /** The error findings (what keeps the draft from opening a pull request), in gate order. */
  readonly errors: readonly GateResultItem[];
  /** Each error finding as text, with its rule statement and fix. */
  readonly problems: readonly string[];
  /** True when no gate reported an error (flags and notes are for the reviewer, not blockers). */
  readonly passed: boolean;
}

/** The repository-relative prefix of the content root: `.` → `""`, `./content/` → `"content/"`. */
export function contentPrefix(root: string): string {
  const trimmed = root.replace(/^\.\/?/u, '').replace(/\/+$/u, '');
  return trimmed === '' ? '' : `${trimmed}/`;
}

/** Repository-relative path of a passage file under the configured content root. */
export function draftPath(config: Pick<LectioConfig, 'content'>, key: string): string {
  return `${contentPrefix(config.content.root)}passages/${key}.json`;
}

/** Runs the gates on `text` as the content of `path`. */
export async function runDraftGates(path: string, text: string, deps: DraftGateDeps): Promise<DraftGateRun> {
  const readBase = deps.readBase ?? (() => null);
  const change: ChangedFile = { path, status: readBase(path) === null ? 'added' : 'modified' };
  const readText = deps.readText ?? nodeReadText;
  const draftAbsolute = join(deps.root, path);
  const gates = deps.gates ?? preValidationGates();
  const context = createContext({
    root: deps.root,
    base: 'base',
    head: 'draft',
    config: deps.config,
    providers: deps.providers,
    git: { changedFiles: () => [change], show: (_ref, file) => readBase(file) },
    ...(deps.repo === undefined ? {} : { repo: deps.repo }),
    readText: (absolute) => (absolute === draftAbsolute ? text : readText(absolute)),
  });
  const report = await runGates(gates, context);
  const errors = report.results.flatMap((result) => result.items.filter((item) => item.severity === 'error'));
  const rules = ruleBookFor(gates);
  return {
    report,
    errors,
    problems: errors.map((item) => formatFinding(item, rules)),
    passed: errors.length === 0,
  };
}
