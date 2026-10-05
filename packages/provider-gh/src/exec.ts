import { spawn } from 'node:child_process';

import { ProviderError } from '@lectio/providers';

/** What a finished command printed and how it exited. */
export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecOptions {
  /** Written to the command's stdin (for `--input -` and `--body-file -`). */
  readonly input?: string;
}

/**
 * Runs one command (`gh` or `git`) with these arguments. It resolves with the exit code even
 * when the command fails; it rejects only when the command could not be started.
 */
export type Exec = (args: readonly string[], options?: ExecOptions) => Promise<ExecResult>;

/**
 * An `Exec` that spawns `command` (default `gh`) with the current environment, so `GH_TOKEN`
 * in Actions and the owner's `gh auth login` session both work.
 */
export function createProcessExec(command = 'gh', options: { readonly cwd?: string } = {}): Exec {
  return (args, execOptions = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) => {
        reject(new ProviderError('unavailable', `could not run ${command}: ${error.message}`, { cause: error }));
      });
      child.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });
      child.stdin.on('error', () => {
        // The command exited before reading its input; `close` reports the outcome.
      });
      child.stdin.end(execOptions.input ?? '');
    });
}

/** Local git operations the client needs (today: which GitHub repository the checkout points at). */
export interface GitRunner {
  /** `owner/name` of the `origin` remote. */
  originRepo(): Promise<string>;
}

/** `owner/name` from a GitHub remote URL (https, ssh or scp-like), or `undefined`. */
export function parseGitHubRemote(url: string): string | undefined {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/** A `GitRunner` on the `git` CLI (or any `Exec` that behaves like it). */
export function createGitRunner(exec: Exec = createProcessExec('git')): GitRunner {
  return {
    async originRepo() {
      const result = await exec(['remote', 'get-url', 'origin']);
      if (result.exitCode !== 0) {
        throw new ProviderError('not-found', `git has no origin remote: ${result.stderr.trim()}`);
      }
      const repo = parseGitHubRemote(result.stdout);
      if (!repo) throw new ProviderError('invalid-request', `origin is not a GitHub remote: ${result.stdout.trim()}`);
      return repo;
    },
  };
}
