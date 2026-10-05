import { ProviderError } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { createGitRunner, createProcessExec, parseGitHubRemote } from './exec.ts';

describe('createProcessExec', () => {
  // Node stands in for gh: spawning a local process is offline.
  const node = createProcessExec(process.execPath);

  it('passes arguments and stdin and collects output and the exit code', async () => {
    const script =
      'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(s.toUpperCase()+process.argv[1]);console.error("warn");process.exit(3)})';
    expect(await node(['-e', script, '!'], { input: 'body' })).toEqual({
      exitCode: 3,
      stdout: 'BODY!\n',
      stderr: 'warn\n',
    });
  });

  it('works without input and when the command ignores stdin', async () => {
    expect(await node(['-e', 'console.log("ok")'])).toEqual({ exitCode: 0, stdout: 'ok\n', stderr: '' });
    const big = 'x'.repeat(1 << 20);
    expect((await node(['-e', 'process.exit(0)'], { input: big })).exitCode).toBe(0);
  });

  it('runs in the given directory', async () => {
    const inTmp = createProcessExec(process.execPath, { cwd: '/' });
    expect((await inTmp(['-e', 'console.log(process.cwd())'])).stdout).toBe('/\n');
  });

  it('reports a killed process as exit 1', async () => {
    expect((await node(['-e', 'process.kill(process.pid, "SIGKILL")'])).exitCode).toBe(1);
  });

  it('rejects as unavailable when the command does not exist', async () => {
    const missing = createProcessExec('lectio-no-such-command');
    const error = await missing([]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('unavailable');
  });
});

describe('parseGitHubRemote', () => {
  it.each([
    ['https://github.com/nyabongo/lectio.git', 'nyabongo/lectio'],
    ['https://github.com/nyabongo/lectio', 'nyabongo/lectio'],
    ['git@github.com:nyabongo/lectio.git\n', 'nyabongo/lectio'],
    ['ssh://git@github.com/nyabongo/lectio.git', 'nyabongo/lectio'],
    ['https://gitlab.com/nyabongo/lectio.git', undefined],
  ])('%s', (url, repo) => {
    expect(parseGitHubRemote(url)).toBe(repo);
  });
});

describe('createGitRunner', () => {
  it('reads the origin remote', async () => {
    const calls: (readonly string[])[] = [];
    const git = createGitRunner(async (args) => {
      calls.push(args);
      return { exitCode: 0, stdout: 'git@github.com:nyabongo/lectio.git\n', stderr: '' };
    });
    expect(await git.originRepo()).toBe('nyabongo/lectio');
    expect(calls).toEqual([['remote', 'get-url', 'origin']]);
  });

  it('rejects without an origin or with a non-GitHub origin', async () => {
    const none = createGitRunner(async () => ({ exitCode: 2, stdout: '', stderr: "error: No such remote 'origin'" }));
    await expect(none.originRepo()).rejects.toMatchObject({ code: 'not-found' });
    const other = createGitRunner(async () => ({ exitCode: 0, stdout: 'https://example.com/x.git', stderr: '' }));
    await expect(other.originRepo()).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('defaults to the git on PATH', () => {
    expect(typeof createGitRunner().originRepo).toBe('function');
  });
});
