import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { monthView, passageView } from './calendar-view.ts';
import { CALENDAR_LOCALE, celebrationLookup, celebrationName } from './calendar-names.ts';
import { dayPageView, upcomingDays } from './day.ts';
import type { DayEnv } from './day.ts';
import { formatDate, t } from '../i18n/index.ts';
import { insightPage } from './insight.ts';
import { readingPage } from './reading.ts';
import { siteContext } from './site.ts';

const sunday = { id: 'ordinary-time-25-sunday', name: 'Twenty-fifth Sunday in Ordinary Time' };
const swahili = (locale: string, id: string) =>
  locale === 'sw' && id === sunday.id ? 'Dominika ya 25 ya Mwaka' : undefined;

describe('celebrationName', () => {
  it('uses the lookup for the locale and falls back to the calendar name, marked with its language', () => {
    expect(celebrationName(sunday, 'sw', swahili)).toEqual({ name: 'Dominika ya 25 ya Mwaka' });
    expect(celebrationName({ id: 'other', name: 'Other' }, 'sw', swahili)).toEqual({ name: 'Other', lang: 'en' });
    expect(celebrationName(sunday, 'en', swahili)).toEqual({ name: sunday.name });
    expect(celebrationName(sunday, undefined, swahili)).toEqual({ name: sunday.name });
    expect(CALENDAR_LOCALE).toBe('en');
  });

  it('has no translations until L-111 provides them', () => {
    expect(celebrationLookup('sw', sunday.id)).toBeUndefined();
    expect(celebrationName(sunday, 'sw')).toEqual({ name: sunday.name, lang: 'en' });
  });
});

describe('views take the page locale for celebration names', () => {
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const context = siteContext({
    cwd: webRoot,
    env: { LECTIO_CONFIG: 'apps/web/test/lectio.config.fixture.json' },
  });
  const { repo } = context;

  it('marks untranslated names in the month, passage, reading and insight views', () => {
    const month = monthView(repo, { year: 2026, month: 9 }, { locale: 'sw' });
    expect(month.celebrations.find((item) => item.date === '2026-09-20')).toMatchObject({
      name: sunday.name,
      nameLang: 'en',
    });
    expect(month.weeks.flat().find((cell) => cell?.date === '2026-09-20')).toMatchObject({ celebrationLang: 'en' });
    expect(passageView(repo, 'MT.20.1-16', undefined, 'sw')?.appearances[0]).toMatchObject({
      celebration: sunday.name,
      celebrationLang: 'en',
    });
    expect(readingPage(repo, '2026-09-20', 'gospel', 'sw')).toMatchObject({
      celebration: sunday.name,
      celebrationLang: 'en',
    });
    expect(insightPage(repo, '2026-09-20', 'gospel', 'v15-evil-eye', 'sw')?.reading.celebrationLang).toBe('en');
    expect(readingPage(repo, '2026-09-20', 'gospel', 'en')?.celebrationLang).toBeUndefined();
  });

  it('marks untranslated names and English notes in the day views', () => {
    const env: DayEnv = { lang: 'sw', messages: { t, formatDate: (l, d) => formatDate(l, d) }, paths: (p) => `/${p}` };
    const view = dayPageView(env, context, '2026-09-20');
    expect(view).toMatchObject({ title: sunday.name, titleLang: 'en' });
    expect(view?.celebrations[0]?.nameLang).toBe('en');
    const gospel = view?.masses[0]?.readings.find((reading) => reading.summary !== null);
    expect(gospel?.summaryLang).toBe('en');
    expect(upcomingDays(env, repo, '2026-09-20')[0]).toMatchObject({ title: sunday.name, titleLang: 'en' });
    const en = dayPageView({ ...env, lang: 'en' }, context, '2026-09-20');
    expect(en?.titleLang).toBeUndefined();
    expect(en?.masses[0]?.readings.find((reading) => reading.summary !== null)?.summaryLang).toBeUndefined();
  });
});
