/** The locale card endpoints (`og/sw/…`, L-113) are built only for the site's other configured locales. */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as Endpoint from './_endpoint.ts';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let endpoint: typeof Endpoint;

beforeAll(async () => {
  vi.stubEnv('LECTIO_CONFIG', 'apps/web/test/lectio.config.fixture.json');
  vi.stubEnv('INIT_CWD', webRoot);
  endpoint = await import('./_endpoint.ts');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('localeCardPaths', () => {
  it('keeps the paths of a configured other locale and drops the rest', () => {
    const paths = [{ params: { date: '2026-09-20' } }];
    expect(endpoint.localeCardPaths(endpoint.SW, paths)).toEqual(paths);
    expect(endpoint.localeCardPaths('pt-BR', paths)).toEqual([]);
    expect(endpoint.localeCardPaths('en', paths)).toEqual([]);
  });

  it('builds Kiswahili cards from the Kiswahili content view', () => {
    expect(endpoint.ogContext(undefined, 'sw')).toMatchObject({ env: { lang: 'sw' }, defaultLocale: 'en' });
    expect(endpoint.ogContext(undefined).env.lang).toBe('en');
  });
});
