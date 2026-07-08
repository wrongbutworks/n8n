import { ScheduledJobRecurrenceUnit } from '@n8n/constants';
import { DateTime } from 'luxon';

import type { RecurringCronSchedule } from '../types';

/**
 * Whether a candidate anchor fire is kept by a `recurring_cron` schedule's
 * every-Nth-period gate, judged purely against the previous fire — no stored
 * counter, so any instance can evaluate it and a restart can't lose the
 * cadence. A candidate passes when its period is the previous fire's own
 * period (a multi-weekday rule fires on each selected day of an on-cadence
 * week) or lies `recurrenceSize` or more periods later, so a backlog after
 * downtime resumes at the next fire instead of waiting out a full cycle — the
 * same catch-up the legacy static-data `recurrenceCheck` had.
 *
 * An elapsed-period gate, not a candidate counter: an anchor that already
 * spaces candidates `recurrenceSize` periods apart (a six-hourly step cron
 * with a size-6 gate) is trivially satisfied, whereas counting candidates
 * would square the stride.
 */
export function isOnCadence(
	previousFire: Date,
	candidate: Date,
	schedule: RecurringCronSchedule,
	timezone: string,
): boolean {
	const elapsed = periodsBetween(previousFire, candidate, schedule.recurrenceUnit, timezone);
	return elapsed === 0 || elapsed >= schedule.recurrenceSize;
}

/**
 * How many calendar periods of `unit` lie between two instants in `timezone`.
 * Wall-clock, not elapsed-time: two instants one minute apart across midnight
 * are a day apart, and DST never shifts any count — including hours, counted
 * as clock-label steps (23:30 → 01:30 is 2) so a six-hourly step anchor with
 * a size-6 gate keeps firing across a DST transition, where the real elapsed
 * time is 5 or 7 hours. This matches the legacy engine's label bookkeeping
 * while fixing its wrap bugs: counts are unbounded (27 hours reads as 27, not
 * 3) and leap years need no special casing. Weeks start on Sunday, matching
 * the legacy engine's week bookkeeping; months count absolutely
 * (year × 12 + month), so sizes of 12 and beyond work across year boundaries.
 */
export function periodsBetween(
	from: Date,
	to: Date,
	unit: ScheduledJobRecurrenceUnit,
	timezone: string,
): number {
	const start = DateTime.fromJSDate(from, { zone: timezone });
	const end = DateTime.fromJSDate(to, { zone: timezone });

	switch (unit) {
		case ScheduledJobRecurrenceUnit.Hours:
			return (
				calendarDaysBetween(start.startOf('day'), end.startOf('day')) * 24 + end.hour - start.hour
			);
		case ScheduledJobRecurrenceUnit.Days:
			return calendarDaysBetween(start.startOf('day'), end.startOf('day'));
		case ScheduledJobRecurrenceUnit.Weeks:
			return calendarDaysBetween(startOfSundayWeek(start), startOfSundayWeek(end)) / 7;
		case ScheduledJobRecurrenceUnit.Months:
			return end.year * 12 + end.month - (start.year * 12 + start.month);
		default: {
			const exhaustive: never = unit;
			return exhaustive;
		}
	}
}

/**
 * Whole calendar days between two local midnights. Their raw diff can be off
 * by an hour around a DST transition, so round it back to the integer day
 * count. Week starts are exact multiples of 7 days apart, which keeps the
 * weeks division above integral.
 */
function calendarDaysBetween(startOfFromDay: DateTime, startOfToDay: DateTime): number {
	return Math.round(startOfToDay.diff(startOfFromDay, 'days').days);
}

/** Local midnight of the Sunday starting the instant's week. Luxon weekdays run Mon=1..Sun=7. */
function startOfSundayWeek(instant: DateTime): DateTime {
	return instant.startOf('day').minus({ days: instant.weekday % 7 });
}
