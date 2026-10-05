/**
 * Calendar context for the research prompt: where the passage is read (its first date in the run
 * window), the celebration and season, its slot in the Mass, and the references (never the text)
 * of the other readings of that Mass.
 */
import type { ContentRepo } from '@lectio/content';
import type { CalendarDay, Celebration } from '@lectio/schema/calendar';
import type { IsoDate } from '@lectio/shared';

import type { WorkItem } from '../plan/plan.ts';

export interface CalendarContext {
  readonly date: IsoDate;
  readonly season: CalendarDay['season'];
  readonly seasonWeek: number;
  readonly sundayCycle: CalendarDay['sundayCycle'];
  readonly weekdayCycle: CalendarDay['weekdayCycle'];
  /** The day's principal celebration. */
  readonly celebration: { readonly name: string; readonly rank: string; readonly colour: string };
  /** The Mass the passage is read at. */
  readonly mass: string;
  /** Slot of the passage in that Mass, for example `gospel`. */
  readonly slot: string;
  /** Every reading of that Mass, by slot and reference, the passage included. */
  readonly readings: readonly { readonly slot: string; readonly ref: string }[];
  /** Every date in the run window the passage is read on. */
  readonly dates: readonly IsoDate[];
}

/** The context at the item's first date, or `null` when the calendar has no such day or reading. */
export function calendarContext(repo: Pick<ContentRepo, 'calendarYear'>, item: WorkItem): CalendarContext | null {
  const day = repo.calendarYear(Number(item.firstDate.slice(0, 4)))?.days.find((d) => d.date === item.firstDate);
  if (day === undefined) return null;
  for (const mass of day.masses) {
    const reading = mass.readings.find((r) => r.key === item.key);
    if (reading === undefined) continue;
    // The calendar schema requires at least one celebration.
    const celebration = day.celebrations[0] as Celebration;
    return {
      date: day.date,
      season: day.season,
      seasonWeek: day.seasonWeek,
      sundayCycle: day.sundayCycle,
      weekdayCycle: day.weekdayCycle,
      celebration: { name: celebration.name, rank: celebration.rank, colour: celebration.colour },
      mass: mass.label,
      slot: reading.slot,
      readings: mass.readings.map((r) => ({ slot: r.slot, ref: r.ref })),
      dates: item.dates,
    };
  }
  return null;
}

/** The context as Markdown for the prompt. */
export function formatCalendarContext(context: CalendarContext | null): string {
  if (context === null) return 'No calendar context is available for this passage.';
  const { celebration } = context;
  return [
    `- Date: ${context.date} (also read on: ${context.dates.join(', ')})`,
    `- Celebration: ${celebration.name} (${celebration.rank}, ${celebration.colour})`,
    `- Season: ${context.season}, week ${String(context.seasonWeek)}; Sunday cycle ${context.sundayCycle}, weekday cycle ${context.weekdayCycle}`,
    `- Mass: ${context.mass}`,
    `- Readings of this Mass (references only): ${context.readings.map((r) => `${r.slot} ${r.ref}`).join('; ')}`,
  ].join('\n');
}
