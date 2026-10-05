import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { beforeAll, describe, expect, it } from 'vitest';

import { formatDate, t } from '../../i18n/index.ts';
import { dayPageView, upcomingDays } from '../../lib/day.ts';
import type { DayEnv, DayView as DayViewModel } from '../../lib/day.ts';
import { siteContext } from '../../lib/site.ts';
import DayView from './DayView.astro';
import UpcomingDays from './UpcomingDays.astro';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '../../..');
const context = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } });
const env: DayEnv = {
  lang: 'en',
  messages: { t, formatDate: (locale, date) => formatDate(locale, date) },
  paths: (path) => `/lectio/${path}`,
};

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

function view(date: string, listen = false): DayViewModel {
  const config = { ...context.config, site: { ...context.config.site, features: { listen } } };
  const result = dayPageView(env, { config, repo: context.repo }, date);
  if (result === null) throw new Error(`no fixture day ${date}`);
  return result;
}

/** The markup without scoped-style and dev-source attributes, one tag per line, so the snapshot reads as HTML. */
function clean(html: string): string {
  return html
    .replace(/ data-astro-cid-[a-z0-9]+(?:="[^"]*")?/g, '')
    .replace(/ data-astro-source-(?:file|loc)="[^"]*"/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replaceAll('><', '>\n<');
}

describe('DayView', () => {
  it('renders 2026-09-20 from the fixture content root', async () => {
    const html = clean(await container.renderToString(DayView, { props: { view: view('2026-09-20') } }));
    expect(html).toMatchSnapshot();
  });

  it('links the Gospel to its Reading page and marks the pending Isaiah note as in preparation', async () => {
    const html = await container.renderToString(DayView, { props: { view: view('2026-09-20') } });
    expect(html).toMatch(/<a href="\/lectio\/2026-09-20\/gospel\/"[^>]*>Matthew 20:1–16a<\/a>/);
    expect(html).toMatch(/Isaiah 55:6–9<\/h3>\s*<p class="reading__pending"[^>]*>Notes in preparation<\/p>/);
    expect(
      html.match(/href="https:\/\/www\.drbo\.org\/chapter\/\d+\.htm" target="_blank" rel="noopener noreferrer"/g),
    ).toHaveLength(4);
    expect(html).toContain('Matthew 20:1–16a at Douay-Rheims (drbo.org) (opens in a new tab)');
    expect(html).not.toContain('listen-button');
  });

  it('shows the liturgical colour as visible text next to the rank, not only as a swatch (#202)', async () => {
    const html = clean(await container.renderToString(DayView, { props: { view: view('2026-09-21') } }));
    expect(html).toMatch(
      /<span class="swatch" aria-hidden="true">\s*<\/span>\s*<span>Feast <span aria-hidden="true">· Red<\/span>/,
    );
    expect(html).toContain('<span aria-hidden="true">· Red</span>');
    expect(html).toContain('<span class="visually-hidden">Liturgical colour: Red</span>');
    expect(html).not.toContain('role="img"');
  });

  it('still shows the references and link-outs on a day with no notes', async () => {
    const html = await container.renderToString(DayView, { props: { view: view('2026-09-19') } });
    expect(html).toContain('Luke 8:4–15');
    expect(html.match(/Notes in preparation/g)).toHaveLength(3);
    expect(html.match(/href="https:\/\/www\.drbo\.org\//g)).toHaveLength(3);
    expect(html).not.toContain('rel="prev"');
    expect(html).toContain('rel="next"');
  });

  it('renders the Listen button and the eyebrow when asked', async () => {
    const html = await container.renderToString(DayView, {
      props: { view: view('2026-09-20', true), eyebrow: 'Today' },
    });
    expect(html).toMatch(
      /<a class="listen-button" href="\/lectio\/2026-09-20\/listen\/"[^>]*>[\s\S]*Listen to the notes/,
    );
    expect(html).toMatch(/<p class="eyebrow"[^>]*>Today<\/p>/);
  });

  it('shows Mass labels, other celebrations and the missing-readings notice', async () => {
    const base = view('2026-09-20');
    const mass = base.masses[0];
    if (mass === undefined) throw new Error('fixture has a Mass');
    const many: DayViewModel = {
      ...base,
      celebrations: [
        ...base.celebrations,
        { name: 'Saint B', rank: 'Optional memorial', colour: 'white', colourLabel: 'White' },
      ],
      masses: [mass, { ...mass, id: 'vigil', label: 'Vigil Mass' }],
      massOptions: 'This day has 2 Masses to choose from.',
      previous: null,
      next: null,
    };
    const html = await container.renderToString(DayView, { props: { view: many } });
    expect(html).toMatch(/<h3 class="mass__label"[^>]*>Vigil Mass<\/h3>/);
    expect(html).toMatch(/<h4 class="reading__ref"[^>]*>/);
    expect(html).not.toMatch(/<h3 class="reading__ref"/);
    expect(html).toContain('This day has 2 Masses to choose from.');
    expect(html).toMatch(/Saint B[\s\S]*Optional memorial · White/);
    expect(html).not.toContain('day-nav');

    const missing = await container.renderToString(DayView, {
      props: { view: { ...base, masses: [], missing: 'The readings for this day are not listed yet.' } },
    });
    expect(missing).toContain('The readings for this day are not listed yet.');
  });
});

describe('UpcomingDays', () => {
  it('lists the days ahead with links', async () => {
    const days = upcomingDays(env, context.repo, '2026-09-20');
    const html = await container.renderToString(UpcomingDays, { props: { heading: 'The days ahead', days } });
    expect(html).toContain('The days ahead');
    expect(html).toMatch(
      /<a href="\/lectio\/2026-09-21\/"[^>]*><time datetime="2026-09-21"[^>]*>Monday 21 September 2026/,
    );
  });

  it('renders nothing without days', async () => {
    const html = await container.renderToString(UpcomingDays, { props: { heading: 'The days ahead', days: [] } });
    expect(html.trim()).toBe('');
  });
});
