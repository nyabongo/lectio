import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from './test-server.ts';

describe('offline guard (vitest.setup.ts)', () => {
  it('fails a unit test that calls fetch to a real host', async () => {
    await expect(fetch('https://example.org/')).rejects.toThrow();
  });

  it('lets a test answer requests with its own handler', async () => {
    server.use(http.get('https://example.org/page', () => HttpResponse.text('hello')));
    const response = await fetch('https://example.org/page');
    expect(await response.text()).toBe('hello');
  });

  it('resets handlers between tests', async () => {
    await expect(fetch('https://example.org/page')).rejects.toThrow();
  });
});
