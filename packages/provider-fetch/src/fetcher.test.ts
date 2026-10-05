import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeClock, ProviderError } from '@lectio/providers';
import { describeSourceFetcherContract } from '@lectio/providers/contracts';
import { server } from '@lectio/shared/test-server';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { defaultSourceCacheDir } from './cache.ts';
import { LiveSourceFetcher } from './fetcher.ts';
import type { LiveSourceFetcherOptions } from './fetcher.ts';
import { USER_AGENT } from './http.ts';
import { RobotsDisallowedError } from './robots.ts';

const SITE = 'https://source.test';
const ARCHIVE = 'https://archive.test';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lectio-fetch-'));
  dirs.push(dir);
  return dir;
}

const PAGE = `<!doctype html><html><head><title>Codex</title><script>track()</script></head>
<body><nav>Home | About</nav><main><h1>The codex</h1><p>Early Christians   preferred the <em>codex</em>.</p></main>
<footer>© example</footer></body></html>`;

/** robots.txt for an origin: allow everything unless `body` says otherwise. */
function robots(origin: string, body = 'User-agent: *\nDisallow:\n') {
  return http.get(`${origin}/robots.txt`, () => HttpResponse.text(body));
}

function fetcher(options: LiveSourceFetcherOptions = {}): { fetcher: LiveSourceFetcher; sleeps: number[] } {
  const sleeps: number[] = [];
  const instance = new LiveSourceFetcher({
    clock: new FakeClock(),
    cacheDir: false,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  return { fetcher: instance, sleeps };
}

describe('LiveSourceFetcher', () => {
  describeSourceFetcherContract(
    () => {
      server.use(
        robots(SITE),
        http.get(`${SITE}/known`, () => HttpResponse.html(PAGE)),
        http.get(`${SITE}/missing`, () => new HttpResponse('gone', { status: 404 })),
      );
      return { fetcher: fetcher().fetcher, knownUrl: `${SITE}/known`, missingUrl: `${SITE}/missing` };
    },
    { name: 'live (msw)', deterministic: true },
  );

  it('sends the LectioBot User-Agent and reduces HTML to its main text', async () => {
    const agents: (string | null)[] = [];
    server.use(
      http.get(`${SITE}/robots.txt`, ({ request }) => {
        agents.push(request.headers.get('user-agent'));
        return HttpResponse.text('');
      }),
      http.get(`${SITE}/page`, ({ request }) => {
        agents.push(request.headers.get('user-agent'));
        return HttpResponse.html(PAGE);
      }),
    );
    const page = await fetcher().fetcher.fetch(`${SITE}/page`);
    expect(agents).toEqual([USER_AGENT, USER_AGENT]);
    expect(page).toEqual({
      status: 200,
      text: 'The codex\n\nEarly Christians preferred the codex.',
      contentType: 'text/html',
      retrievedAt: '2026-01-01T00:00:00.000Z',
      finalUrl: `${SITE}/page`,
      fromArchive: false,
    });
  });

  it('follows redirects, relative and across origins, and reports the final URL', async () => {
    server.use(
      robots(SITE),
      robots(ARCHIVE),
      http.get(`${SITE}/old`, () => new HttpResponse(null, { status: 301, headers: { location: '/new' } })),
      http.get(`${SITE}/new`, () => new HttpResponse(null, { status: 302, headers: { location: `${ARCHIVE}/final` } })),
      http.get(`${ARCHIVE}/final`, () => HttpResponse.text('arrived')),
    );
    const page = await fetcher().fetcher.fetch(`${SITE}/old`);
    expect(page).toMatchObject({ status: 200, text: 'arrived', finalUrl: `${ARCHIVE}/final` });
  });

  it('gives up after too many redirects', async () => {
    server.use(
      robots(SITE),
      http.get(`${SITE}/loop`, () => new HttpResponse(null, { status: 307, headers: { location: '/loop' } })),
    );
    const error = await fetcher({ maxRedirects: 2 })
      .fetcher.fetch(`${SITE}/loop`)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toBe(`GET ${SITE}/loop: more than 2 redirects`);
  });

  it('retries a 429 after the Retry-After delay, then succeeds', async () => {
    let calls = 0;
    server.use(
      robots(SITE),
      http.get(`${SITE}/busy`, () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse('slow down', { status: 429, headers: { 'retry-after': '2' } })
          : HttpResponse.text('ok now');
      }),
    );
    const { fetcher: live, sleeps } = fetcher();
    const page = await live.fetch(`${SITE}/busy`);
    expect(page).toMatchObject({ status: 200, text: 'ok now' });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it('backs off exponentially and resolves with the last status once retries are spent', async () => {
    server.use(
      robots(SITE),
      http.get(`${SITE}/down`, () => new HttpResponse('unavailable', { status: 503 })),
    );
    const { fetcher: live, sleeps } = fetcher({ retries: 3, backoffMs: 100 });
    const page = await live.fetch(`${SITE}/down`);
    expect(page.status).toBe(503);
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it('refuses a page robots.txt disallows for LectioBot, without requesting it', async () => {
    let requested = false;
    server.use(
      robots(SITE, 'User-agent: *\nDisallow:\n\nUser-agent: LectioBot\nDisallow: /private/\n'),
      http.get(`${SITE}/private/page`, () => {
        requested = true;
        return HttpResponse.text('secret');
      }),
    );
    const error = await fetcher()
      .fetcher.fetch(`${SITE}/private/page`)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RobotsDisallowedError);
    expect(error).toMatchObject({ code: 'unsupported', retryable: false, url: `${SITE}/private/page` });
    expect(requested).toBe(false);
  });

  it('checks robots.txt on every redirect hop', async () => {
    server.use(
      robots(SITE),
      robots(ARCHIVE, 'User-agent: *\nDisallow: /\n'),
      http.get(`${SITE}/out`, () => new HttpResponse(null, { status: 301, headers: { location: `${ARCHIVE}/x` } })),
    );
    await expect(fetcher().fetcher.fetch(`${SITE}/out`)).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it('caches robots.txt per origin until its TTL runs out', async () => {
    let robotsCalls = 0;
    server.use(
      http.get(`${SITE}/robots.txt`, () => {
        robotsCalls += 1;
        return new HttpResponse(null, { status: 404 });
      }),
      http.get(`${SITE}/a`, () => HttpResponse.text('a')),
    );
    const clock = new FakeClock();
    const { fetcher: live } = fetcher({ clock, robotsTtlMs: 1000 });
    await Promise.all([live.fetch(`${SITE}/a`), live.fetch(`${SITE}/a`)]);
    await live.fetch(`${SITE}/a`);
    expect(robotsCalls).toBe(1);
    clock.advance(1000);
    await live.fetch(`${SITE}/a`);
    expect(robotsCalls).toBe(2);
  });

  it('treats a failing robots.txt as disallowing everything', async () => {
    server.use(
      http.get(`${SITE}/robots.txt`, () => new HttpResponse(null, { status: 500 })),
      http.get(`${SITE}/a`, () => HttpResponse.text('a')),
    );
    await expect(fetcher({ retries: 0 }).fetcher.fetch(`${SITE}/a`)).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it('ignores robots.txt when told to', async () => {
    server.use(http.get(`${SITE}/a`, () => HttpResponse.text('a')));
    expect((await fetcher({ robots: false }).fetcher.fetch(`${SITE}/a`)).text).toBe('a');
  });

  it('decodes a non-UTF-8 page from the header charset, a <meta> charset, or a byte-order mark', async () => {
    const latin1 = Uint8Array.from([
      ...Buffer.from('<p>Caf'),
      0xe9,
      ...Buffer.from(' cr'),
      0xe8,
      ...Buffer.from('me</p>'),
    ]);
    const meta = Uint8Array.from([
      ...Buffer.from('<html><head><meta charset="windows-1252"></head><body><p>'),
      0x93,
      ...Buffer.from('Agape'),
      0x94,
      ...Buffer.from('</p></body></html>'),
    ]);
    const utf16 = Uint8Array.from([0xff, 0xfe, ...Buffer.from('Ἀρχή', 'utf16le')]);
    server.use(
      robots(SITE),
      http.get(
        `${SITE}/latin1`,
        () => new HttpResponse(latin1, { headers: { 'content-type': 'text/html; charset=ISO-8859-1' } }),
      ),
      http.get(`${SITE}/meta`, () => new HttpResponse(meta, { headers: { 'content-type': 'text/html' } })),
      http.get(`${SITE}/bom`, () => new HttpResponse(utf16, { headers: { 'content-type': 'text/plain' } })),
    );
    const { fetcher: live } = fetcher();
    expect((await live.fetch(`${SITE}/latin1`)).text).toBe('Café crème');
    expect((await live.fetch(`${SITE}/meta`)).text).toBe('“Agape”');
    expect((await live.fetch(`${SITE}/bom`)).text).toBe('Ἀρχή');
  });

  it('flags a PDF, or another binary body, as unsupported with no text', async () => {
    server.use(
      robots(SITE),
      http.get(
        `${SITE}/paper.pdf`,
        () => new HttpResponse(Buffer.from('%PDF-1.7 ...'), { headers: { 'content-type': 'application/pdf' } }),
      ),
      http.get(`${SITE}/sniffed`, () => new HttpResponse(Buffer.from('%PDF-1.4 ...'))),
      http.get(
        `${SITE}/image.png`,
        () => new HttpResponse(Uint8Array.from([0x89, 0x50]), { headers: { 'content-type': 'image/png' } }),
      ),
    );
    const { fetcher: live } = fetcher();
    expect(await live.fetch(`${SITE}/paper.pdf`)).toMatchObject({
      status: 200,
      text: '',
      contentType: 'application/pdf',
      unsupported: 'pdf',
    });
    expect(await live.fetch(`${SITE}/sniffed`)).toMatchObject({ contentType: 'application/pdf', unsupported: 'pdf' });
    expect(await live.fetch(`${SITE}/image.png`)).toMatchObject({ text: '', unsupported: 'binary' });
  });

  describe('archive fallback', () => {
    const archived = `${ARCHIVE}/web/2024/${SITE}/gone`;

    it('uses archivedUrl when the page is missing', async () => {
      server.use(
        robots(SITE),
        robots(ARCHIVE),
        http.get(`${SITE}/gone`, () => new HttpResponse('not found', { status: 404 })),
        http.get(archived, () => HttpResponse.html('<div id="wm-ipp-base">Wayback toolbar</div><p>Preserved</p>')),
      );
      const page = await fetcher().fetcher.fetch(`${SITE}/gone`, { archivedUrl: archived });
      expect(page).toMatchObject({ status: 200, text: 'Preserved', finalUrl: archived, fromArchive: true });
    });

    it('uses archivedUrl when the site is unreachable or disallowed', async () => {
      server.use(
        robots(ARCHIVE),
        http.get(`${SITE}/robots.txt`, () => HttpResponse.error()),
        http.get(archived, () => HttpResponse.text('Preserved')),
      );
      const page = await fetcher({ retries: 0 }).fetcher.fetch(`${SITE}/gone`, { archivedUrl: archived });
      expect(page).toMatchObject({ text: 'Preserved', fromArchive: true });

      server.use(robots(SITE, 'User-agent: *\nDisallow: /\n'));
      const disallowed = await fetcher().fetcher.fetch(`${SITE}/gone`, { archivedUrl: archived });
      expect(disallowed.fromArchive).toBe(true);
    });

    it("reports the page's own status when the archive fails too", async () => {
      server.use(
        robots(SITE),
        robots(ARCHIVE),
        http.get(`${SITE}/gone`, () => new HttpResponse('not found', { status: 404 })),
        http.get(archived, () => new HttpResponse(null, { status: 404 })),
      );
      const page = await fetcher().fetcher.fetch(`${SITE}/gone`, { archivedUrl: archived });
      expect(page).toMatchObject({ status: 404, text: 'not found', fromArchive: false });

      server.use(http.get(archived, () => HttpResponse.error()));
      expect((await fetcher({ retries: 0 }).fetcher.fetch(`${SITE}/gone`, { archivedUrl: archived })).status).toBe(404);
    });

    it("rethrows the page's own failure when the archive fails too", async () => {
      server.use(
        http.get(`${SITE}/robots.txt`, () => HttpResponse.error()),
        http.get(`${ARCHIVE}/robots.txt`, () => HttpResponse.error()),
      );
      const error = await fetcher({ retries: 0 })
        .fetcher.fetch(`${SITE}/gone`, { archivedUrl: archived })
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: 'unavailable', message: expect.stringContaining(`${SITE}/robots.txt`) });
    });
  });

  describe('on-disk cache', () => {
    it('serves a cached page without a request until the TTL runs out', async () => {
      const cacheDir = await tempDir();
      const clock = new FakeClock();
      let calls = 0;
      server.use(
        robots(SITE),
        http.get(`${SITE}/cached`, () => {
          calls += 1;
          return HttpResponse.text(`version ${calls}`);
        }),
      );
      const options = { clock, cacheDir, cacheTtlMs: 60_000 };
      const first = await fetcher(options).fetcher.fetch(`${SITE}/cached`);
      clock.advance(30_000);
      const second = await fetcher(options).fetcher.fetch(`${SITE}/cached`);
      expect(second).toEqual(first);
      expect(calls).toBe(1);
      expect(await readdir(cacheDir)).toHaveLength(1);

      clock.advance(30_000);
      const third = await fetcher(options).fetcher.fetch(`${SITE}/cached`);
      expect(third).toMatchObject({ text: 'version 2', retrievedAt: '2026-01-01T00:01:00.000Z' });
      expect(calls).toBe(2);
    });

    it('does not cache failures, and marks a cached archive page as from the archive', async () => {
      const cacheDir = await tempDir();
      let calls = 0;
      server.use(
        robots(SITE),
        robots(ARCHIVE),
        http.get(`${SITE}/gone`, () => {
          calls += 1;
          return new HttpResponse(null, { status: 404 });
        }),
        http.get(`${ARCHIVE}/copy`, () => HttpResponse.text('copy')),
      );
      const live = fetcher({ cacheDir }).fetcher;
      await live.fetch(`${SITE}/gone`, { archivedUrl: `${ARCHIVE}/copy` });
      const again = await live.fetch(`${SITE}/gone`, { archivedUrl: `${ARCHIVE}/copy` });
      expect(again).toMatchObject({ text: 'copy', fromArchive: true });
      expect(calls).toBe(2);
      expect(await live.fetch(`${ARCHIVE}/copy`)).toMatchObject({ fromArchive: false });
    });

    it('treats a corrupt or foreign cache entry as a miss', async () => {
      const cacheDir = await tempDir();
      server.use(
        robots(SITE),
        http.get(`${SITE}/a`, () => HttpResponse.text('fresh')),
      );
      const live = fetcher({ cacheDir }).fetcher;
      await live.fetch(`${SITE}/a`);
      const [name] = await readdir(cacheDir);
      await writeFile(join(cacheDir, name as string), '{not json');
      expect((await live.fetch(`${SITE}/a`)).text).toBe('fresh');
      await writeFile(join(cacheDir, name as string), JSON.stringify({ url: 'other', storedAt: 0, page: {} }));
      expect((await live.fetch(`${SITE}/a`)).text).toBe('fresh');
    });

    it('defaults to <repo>/.cache/sources', () => {
      expect(() => new LiveSourceFetcher()).not.toThrow();
      expect(defaultSourceCacheDir({ INIT_CWD: '/' }, '/')).toBe('/.cache/sources');
    });
  });

  it('rejects a URL that is not http(s)', async () => {
    await expect(fetcher().fetcher.fetch('ftp://source.test/file')).rejects.toMatchObject({
      code: 'invalid-request',
    });
  });
});
