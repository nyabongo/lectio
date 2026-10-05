import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeCacheStorage } from './fixtures/fakes.ts';
import type { WaitUntilEvent } from './worker.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('service worker entry', () => {
  it('installs the worker on the global scope with the injected configuration', async () => {
    const listeners = new Map<string, (event: WaitUntilEvent) => void>();
    const caches = new FakeCacheStorage();
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 503 })));
    const claim = vi.fn(() => Promise.resolve());
    vi.stubGlobal('__LECTIO_SW__', { version: 'test', precache: [] });
    vi.stubGlobal('addEventListener', (type: string, listener: (event: WaitUntilEvent) => void) => {
      listeners.set(type, listener);
    });
    vi.stubGlobal('registration', { scope: 'https://example.org/lectio/' });
    vi.stubGlobal('clients', { claim });
    vi.stubGlobal('skipWaiting', () => Promise.resolve());
    vi.stubGlobal('caches', caches);
    vi.stubGlobal('fetch', fetch);

    await import('./index.ts');
    expect([...listeners.keys()].sort()).toEqual(['activate', 'fetch', 'install', 'message']);

    const waits: Promise<unknown>[] = [];
    listeners.get('activate')?.({ waitUntil: (promise) => void waits.push(promise) });
    await Promise.all(waits);
    expect(claim).toHaveBeenCalledOnce();
    const message = { data: { type: 'prefetch', today: '2026-09-20' }, origin: 'https://example.org' };
    listeners.get('message')?.({ ...message, waitUntil: (promise) => void waits.push(promise) } as WaitUntilEvent);
    await Promise.all(waits);
    expect(fetch).toHaveBeenCalledWith('https://example.org/lectio/api/v1/index.json', { cache: 'no-cache' });
  });
});
