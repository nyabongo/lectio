/**
 * Pre-registered npm scripts.
 *
 * L-001 writes every root and workspace `package.json` for the whole roadmap so
 * no later issue edits a manifest or the lockfile. A script whose code does not
 * exist yet is declared as
 *
 *     "calendar:build": "tsx ../../scripts/run-planned.mjs L-017 src/cli/build.ts"
 *
 * `scripts/run-planned.mjs` runs the target (relative to the workspace) with
 * tsx once the owning issue has created it, and until then prints
 * `not implemented (L-017)` and exits 1. Without a target the script is a pure
 * placeholder for an issue that will rewrite the manifest itself (apps/web, L-050).
 */

export const PLANNED_RUNNER = 'tsx ../../scripts/run-planned.mjs';

/** Root scripts L-001 pre-registers, each delegating to one workspace. */
export const PLANNED_ROOT_SCRIPTS = [
  'research',
  'calendar:build',
  'calendar:check',
  'calendar:report',
  'corpus:find',
  'corpus:licences',
  'corpus:import:greek',
  'corpus:import:hebrew',
  'corpus:import:latin',
  'corpus:import:lxx',
  'guard:build',
  'content:validate',
  'lectionary:check',
  'lectionary:crosscheck',
  'gates:docs',
  'review:approve',
  'audio:render',
  'schema:emit',
  'runway',
] as const;

const ISSUE_ID = /^L-\d{3}[a-z]?$/;

export type PlannedRun =
  { kind: 'run'; command: string; args: string[] } | { kind: 'exit'; code: number; message: string };

export interface PlannedRunContext {
  /** Whether a path (relative to the workspace) exists. */
  exists: (path: string) => boolean;
  /** Node binary and flags of the current process (tsx's loader), reused for the target. */
  execPath: string;
  execArgv: string[];
}

/** Decides what `run-planned.mjs <issue> [target] [...args]` does. */
export function planScriptRun(argv: string[], context: PlannedRunContext): PlannedRun {
  const [issue, target, ...args] = argv;
  if (issue === undefined || !ISSUE_ID.test(issue)) {
    return { kind: 'exit', code: 2, message: 'usage: run-planned.mjs <L-NNN> [target] [...args]' };
  }
  if (target === undefined || !context.exists(target)) {
    return { kind: 'exit', code: 1, message: `not implemented (${issue})` };
  }
  return { kind: 'run', command: context.execPath, args: [...context.execArgv, target, ...args] };
}

/** `{ issue, target }` of a planned workspace script, or undefined for any other command. */
export function parsePlannedScript(command: string): { issue: string; target?: string } | undefined {
  // Example: "tsx ../../scripts/run-planned.mjs L-017 src/cli/build.ts" → { issue: 'L-017', target: 'src/cli/build.ts' }
  if (!command.startsWith(`${PLANNED_RUNNER} `)) return undefined;
  const [issue, target] = command
    .slice(PLANNED_RUNNER.length + 1)
    .trim()
    .split(/\s+/);
  if (!ISSUE_ID.test(String(issue))) return undefined;
  return target === undefined ? { issue: String(issue) } : { issue: String(issue), target };
}

export interface Manifest {
  name: string;
  scripts?: Record<string, string>;
}

/**
 * Checks that every pre-registered root script exists and delegates to a script
 * that exists in the named workspace (`npm run -w <workspace> <script> --`).
 */
export function checkRootScripts(root: Manifest, workspaces: Manifest[]): string[] {
  const problems: string[] = [];
  const rootScripts = root.scripts ?? {};
  const byName = new Map(workspaces.map((manifest) => [manifest.name, manifest.scripts ?? {}]));
  for (const name of PLANNED_ROOT_SCRIPTS) {
    const command = rootScripts[name];
    if (command === undefined) {
      problems.push(`root script '${name}' is missing`);
      continue;
    }
    const match = /^npm run -w (\S+) (\S+) --$/.exec(command);
    if (!match) {
      problems.push(`root script '${name}' must be "npm run -w @lectio/<pkg> <script> --"`);
      continue;
    }
    const workspace = String(match[1]);
    const script = String(match[2]);
    const scripts = byName.get(workspace);
    if (scripts === undefined) problems.push(`root script '${name}' targets unknown workspace ${workspace}`);
    else if (scripts[script] === undefined)
      problems.push(`root script '${name}': ${workspace} has no script '${script}'`);
  }
  return problems;
}
