import { FakeGitHubClient, markerComment } from '@lectio/providers';
import { describe, expect, it } from 'vitest';

import { fixtureRepo } from './fixtures/memory-repo.ts';
import type { FixtureDays } from './fixtures/memory-repo.ts';
import { RUNWAY_ISSUE_TITLE, RUNWAY_MARKER, renderIssue, runMonitor } from './monitor.ts';
import { computeRunway } from './runway.ts';

const config = { windowDays: 5, maxMissingDays: 2 };
const from = '2026-10-05';
const KEYS = ['IS.55.6-9', 'MT.20.1-16', 'LK.2.16-21', 'PHIL.1.20-24', 'GAL.4.4-7'] as const;

/** Five days, one reading each (KEYS[i] on day i). */
const days: FixtureDays = Object.fromEntries(
  KEYS.map((key, i) => [`2026-10-${String(5 + i).padStart(2, '0')}`, [[key]]]),
);

function repoWith(approved: readonly string[]) {
  return fixtureRepo({ days, approved, pending: KEYS.filter((key) => !approved.includes(key)) });
}

describe('runMonitor (fixture runs against a fake GitHub)', () => {
  it('healthy runway: the issue is written closed and stays closed', async () => {
    const github = new FakeGitHubClient({ actor: 'github-actions[bot]' });
    const result = await runMonitor({ from, config, repo: repoWith(KEYS.slice(0, 4)), github });
    expect(result.exceeded).toBe(false);
    expect(result.report.days.map((day) => day.date)).toEqual(['2026-10-09']);
    expect(result.issue.state).toBe('closed');
    expect(result.issue.title).toBe(RUNWAY_ISSUE_TITLE);
    expect(result.issue.body).toContain(markerComment(RUNWAY_MARKER));
    expect(result.issue.body).toContain('Recovered: 1 day');
  });

  it('threshold exceeded, still exceeded, then recovered: one issue opened, updated, closed', async () => {
    const github = new FakeGitHubClient({ actor: 'github-actions[bot]' });

    // Exceeded: 4 of 5 days lack approved notes (max 2) -> the issue is opened.
    const opened = await runMonitor({ from, config, repo: repoWith(['IS.55.6-9']), github });
    expect(opened.exceeded).toBe(true);
    expect(opened.created).toBe(true);
    expect(opened.issue.state).toBe('open');
    expect(opened.issue.author).toBe('github-actions[bot]');
    expect(opened.issue.body).toContain('**4 days** in the window 2026-10-05 to 2026-10-09 (5 days)');
    expect(opened.issue.body).toContain('| 2026-10-06 | `MT.20.1-16` |');
    expect(opened.issue.body).toContain(markerComment(RUNWAY_MARKER));

    // Still exceeded: 3 days -> the same issue is updated and stays open.
    const updated = await runMonitor({ from, config, repo: repoWith(['IS.55.6-9', 'MT.20.1-16']), github });
    expect(updated.exceeded).toBe(true);
    expect(updated.created).toBe(false);
    expect(updated.issue.number).toBe(opened.issue.number);
    expect(updated.issue.state).toBe('open');
    expect(updated.issue.body).toContain('**3 days**');
    expect(updated.issue.body).not.toContain('`MT.20.1-16`');

    // Recovered: 2 days (the maximum) -> the same issue is updated and closed.
    const closed = await runMonitor({ from, config, repo: repoWith(KEYS.slice(0, 3)), github });
    expect(closed.exceeded).toBe(false);
    expect(closed.created).toBe(false);
    expect(closed.issue.number).toBe(opened.issue.number);
    expect(closed.issue.state).toBe('closed');
    expect(closed.issue.body).toContain('Recovered: 2 days');

    // Exceeded again later: the same issue is reopened, never a second one.
    const reopened = await runMonitor({ from, config, repo: repoWith([]), github });
    expect(reopened.issue.number).toBe(opened.issue.number);
    expect(reopened.issue.state).toBe('open');
    const events = await github.listIssueEvents(opened.issue.number);
    expect(events.map((event) => event.event)).toEqual(['closed', 'reopened']);
  });
});

describe('renderIssue', () => {
  it('names the missing passages and points at calendar:build for dates without a calendar entry', () => {
    const repo = fixtureRepo({ days: { '2026-12-31': [['MT.20.1-16', 'IS.55.6-9']] } });
    const report = computeRunway({ from: '2026-12-31', windowDays: 2, repo });
    const { title, body } = renderIssue(report, { windowDays: 2, maxMissingDays: 1 });
    expect(title).toBe(RUNWAY_ISSUE_TITLE);
    expect(body).toContain('**2 days** in the window 2026-12-31 to 2027-01-01 (2 days)');
    expect(body).toContain('more than the 1 allowed');
    expect(body).toContain('| 2026-12-31 | `IS.55.6-9`, `MT.20.1-16` |');
    expect(body).toContain('| 2027-01-01 | no calendar entry (run `npm run calendar:build`) |');
    expect(body).toContain('**Passages to research (2):** `IS.55.6-9`, `MT.20.1-16`');
  });

  it('has no table when nothing is missing, and no passage list when only calendar entries are missing', () => {
    const empty = renderIssue(
      { from: '2026-10-05', to: '2026-10-05', windowDays: 1, days: [] },
      { windowDays: 1, maxMissingDays: 0 },
    );
    expect(empty.body).toContain('Recovered: 0 days in the window 2026-10-05 to 2026-10-05 (1 day)');
    expect(empty.body).not.toContain('| Date |');

    const noCalendar = renderIssue(
      {
        from: '2026-10-05',
        to: '2026-10-05',
        windowDays: 1,
        days: [{ date: '2026-10-05', reason: 'no-calendar', missing: [] }],
      },
      { windowDays: 1, maxMissingDays: 0 },
    );
    expect(noCalendar.body).toContain('**1 day**');
    expect(noCalendar.body).not.toContain('Passages to research');
  });
});
