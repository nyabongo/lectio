import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { monthView, passageView } from './calendar-view.ts';
import { celebrationLookup, celebrationName } from './calendar-names.ts';
import { insightPage } from './insight.ts';
import { readingPage } from './reading.ts';
import { siteContext } from './site.ts';

const sunday = { id: 'ordinary-time-25-sunday', name: 'Twenty-fifth Sunday in Ordinary Time' };
const swahili = (locale: string, id: string) =>
  locale === 'sw' && id === sunday.id ? 'Dominika ya 25 ya Mwaka' : undefined;

describe('celebrationName', () => {
  it('uses the lookup for the locale and falls back to the calendar name', () => {
    expect(celebrationName(sunday, 'sw', swahili)).toBe('Dominika ya 25 ya Mwaka');
    expect(celebrationName(sunday, 'en', swahili)).toBe(sunday.name);
    expect(celebrationName({ id: 'other', name: 'Other' }, 'sw', swahili)).toBe('Other');
    expect(celebrationName(sunday, undefined, swahili)).toBe(sunday.name);
  });

  it('has no translations until L-111 provides them', () => {
    expect(celebrationLookup('sw', sunday.id)).toBeUndefined();
    expect(celebrationName(sunday, 'sw')).toBe(sunday.name);
  });
});

describe('views take the page locale for celebration names', () => {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const { repo } = siteContext({ cwd: webRoot, env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' } });

  it('in the month, passage, reading and insight views', () => {
    const month = monthView(repo, { year: 2026, month: 9 }, { locale: 'sw' });
    expect(month.celebrations.map((item) => item.name)).toContain(sunday.name);
    expect(passageView(repo, 'MT.20.1-16', undefined, 'sw')?.appearances[0]?.celebration).toBe(sunday.name);
    expect(readingPage(repo, '2026-09-20', 'gospel', 'sw')?.celebration).toBe(sunday.name);
    expect(insightPage(repo, '2026-09-20', 'gospel', 'v15-evil-eye', 'sw')?.reading.celebration).toBe(sunday.name);
  });
});
