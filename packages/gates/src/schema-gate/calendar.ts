/**
 * The checks of gate 1 on one calendar year that already matches the calendar-year schema: its
 * file name, day order, unique ids, and every reading's reference and key.
 */
import { isKey, isRealVerse, parseRef, toKey } from '@lectio/refs';
import type { CalendarYear } from '@lectio/schema/calendar';

import { finding } from '../core/result.ts';
import type { GateResultItem } from '../core/result.ts';
import { checkUnique } from './passage.ts';
import { SCHEMA_RULES } from './rules.ts';

type Push = (item: GateResultItem) => void;

const YEAR_FILE = /^([0-9]{4})\.json$/;

function checkFileName(push: Push, file: string, calendar: CalendarYear): void {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const match = YEAR_FILE.exec(name);
  if (match === null) {
    push(
      finding(SCHEMA_RULES.keyMatchesFilename, {
        file,
        message: `calendar files are named <year>.json; rename ${name} to ${String(calendar.year)}.json`,
      }),
    );
  } else if (Number(match[1]) !== calendar.year) {
    push(
      finding(SCHEMA_RULES.keyMatchesFilename, {
        file,
        pointer: '/year',
        message: `year ${String(calendar.year)} does not match the file name, which promises ${String(match[1])}`,
      }),
    );
  }
}

function checkReadings(push: Push, file: string, calendar: CalendarYear): void {
  calendar.days.forEach((day, d) => {
    day.masses.forEach((mass, m) => {
      mass.readings.forEach((reading, r) => {
        const at = `/days/${String(d)}/masses/${String(m)}/readings/${String(r)}`;
        const where = `${day.date} ${mass.id} ${reading.slot}`;
        if (!isKey(reading.key)) {
          push(
            finding(SCHEMA_RULES.calendarKeysWellformed, {
              file,
              pointer: `${at}/key`,
              message: `${where}: ${JSON.stringify(reading.key)} is not a canonical passage key`,
            }),
          );
        } else if (!isRealVerse(reading.key)) {
          push(
            finding(SCHEMA_RULES.refIsRealVerse, {
              file,
              pointer: `${at}/key`,
              message: `${where}: ${reading.key} names a chapter or verse that does not exist`,
            }),
          );
        }
        let refKey: string;
        try {
          refKey = toKey(parseRef(reading.ref));
        } catch (error) {
          push(
            finding(SCHEMA_RULES.refParses, {
              file,
              pointer: `${at}/ref`,
              message: `${where}: ${(error as Error).message}`,
            }),
          );
          return;
        }
        if (refKey !== reading.key) {
          push(
            finding(SCHEMA_RULES.calendarKeysWellformed, {
              file,
              pointer: `${at}/key`,
              message: `${where}: ref ${JSON.stringify(reading.ref)} is passage ${refKey}, but key is ${JSON.stringify(reading.key)}`,
            }),
          );
        }
      });
    });
  });
}

function checkOrderAndIds(push: Push, file: string, calendar: CalendarYear): void {
  calendar.days.forEach((day, d) => {
    const previous = calendar.days[d - 1];
    if (previous !== undefined && day.date < previous.date) {
      push(
        finding(SCHEMA_RULES.validCalendar, {
          file,
          pointer: `/days/${String(d)}/date`,
          message: `${day.date} comes after ${previous.date}; days must be in date order`,
        }),
      );
    }
    checkUnique(
      push,
      file,
      `/days/${String(d)}/celebrations`,
      day.celebrations.map((celebration) => celebration.id),
      `${day.date}: celebration id`,
    );
    checkUnique(
      push,
      file,
      `/days/${String(d)}/masses`,
      day.masses.map((mass) => mass.id),
      `${day.date}: Mass id`,
    );
  });
  checkUnique(
    push,
    file,
    '/days',
    calendar.days.map((day) => day.date),
    'date',
    '/date',
  );
}

/** Every gate-1 finding for a schema-valid calendar year at `file`. */
export function checkCalendarRules(file: string, calendar: CalendarYear): GateResultItem[] {
  const items: GateResultItem[] = [];
  const push: Push = (item) => items.push(item);
  checkFileName(push, file, calendar);
  checkOrderAndIds(push, file, calendar);
  checkReadings(push, file, calendar);
  return items;
}
