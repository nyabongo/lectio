import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import { formatDate, t } from '../../i18n/index.ts';
import { listenPageView } from '../../lib/player/listen.ts';
import type { ListenPageView } from '../../lib/player/listen.ts';
import { siteContext } from '../../lib/site.ts';
import ListenPlayer from './ListenPlayer.astro';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

let container: AstroContainer;
let view: ListenPageView;

beforeAll(async () => {
  container = await AstroContainer.create();
  const { config, repo } = siteContext({
    cwd: webRoot,
    env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' },
  });
  const built = listenPageView(
    {
      lang: 'en',
      messages: { t, formatDate: (locale, date) => formatDate(locale, date) },
      paths: (path) => `/${path}`,
    },
    { config, repo, base: '/' },
    '2026-09-20',
  );
  if (built === null) throw new Error('fixture day missing');
  view = built;
});

describe('ListenPlayer', () => {
  it('renders the now-playing panel, labelled controls and the queue grouped by reading', async () => {
    const html = await container.renderToString(ListenPlayer, { props: { view, lang: 'en' } });
    expect(html).toMatch(/<h2 id="now-playing-heading"[^>]*>Now playing<\/h2>/);
    expect(html).toMatch(/role="group" aria-label="Player"/);
    for (const label of ['Play', 'Previous note', 'Next note', 'Back 10 seconds', 'Forward 10 seconds'])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toMatch(
      /<input[^>]*type="range"[^>]*aria-label="Position in this note"[^>]*aria-valuetext="0:00 of 0:00"/,
    );
    expect(html).toMatch(/<label for="listen-speed"[^>]*>Speed<\/label>/);
    expect(html).toMatch(/<option value="1" selected[^>]*>1×<\/option>/);
    expect(html).toMatch(/role="status" aria-live="polite"/);
    expect(html).toMatch(/<h2 id="up-next-heading"[^>]*>Up next<\/h2>/);
    expect(html).toMatch(/<h3 id="queue-group-0"[^>]*>\s*Gospel · Matthew 20:1–16a\s*<\/h3>/);
    expect(html.match(/data-track="\d"/g)).toEqual(['data-track="0"', 'data-track="1"', 'data-track="2"']);
    expect(html).toMatch(/data-track="0" aria-current="true"/);
    expect(html).toMatch(/<kbd[^>]*>Shift \+ N<\/kbd>/);
    expect(html).toContain('The player needs JavaScript.');
  });

  it('hands the player its data as JSON that cannot close the script element', async () => {
    const tricky = {
      ...view,
      data: { ...view.data, tracks: view.data.tracks.map((track) => ({ ...track, title: '</script><b>' })) },
    };
    const html = await container.renderToString(ListenPlayer, { props: { view: tricky, lang: 'en' } });
    const json = /<script type="application\/json" data-listen-data>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    const data = JSON.parse(json) as { tracks: { title: string }[]; speeds: number[]; api: string };
    expect(data.tracks[0]?.title).toBe('</script><b>');
    expect(data.speeds).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(data.api).toBe('/api/v1/days/2026-09-20.json');
  });

  it('marks English stand-ins on a Kiswahili page', async () => {
    const english = {
      ...view,
      data: { ...view.data, tracks: view.data.tracks.map((track) => ({ ...track, fallback: true, lang: 'en' })) },
      groups: view.groups.map((group) => ({
        ...group,
        tracks: group.tracks.map((track) => ({ ...track, fallback: true, lang: 'en' })),
      })),
    };
    const html = await container.renderToString(ListenPlayer, { props: { view: english, lang: 'sw' } });
    expect(html).toContain('Kiingereza pekee');
    expect(html).toMatch(/<span class="queue__title" lang="en"/);
    expect(html).toMatch(/data-now-title lang="en"/);
  });
});
