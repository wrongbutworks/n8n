import { Time } from '@n8n/constants';
import { CronExpressionParser } from 'cron-parser';
import type { CronExpression } from 'n8n-workflow';

import { InvalidScheduleError } from '../errors';
import type {
	CronSchedule,
	IntervalSchedule,
	OneOffSchedule,
	RecurringCronSchedule,
	Schedule,
} from '../types';
import { isOnCadence } from './cadence';
import { validateSchedule } from './validate';

/**
 * How many anchor fires a `recurring_cron` scan may reject before giving up.
 * Real anchors stay far below this (a weekly anchor thinned to every N weeks
 * rejects at most 7×N candidates); hitting the bound means the anchor fires so
 * much more often than the gate passes that the schedule is judged malformed.
 */
const MAX_RECURRENCE_CANDIDATES = 10_000;

type CronCursor = ReturnType<typeof CronExpressionParser.parse>;

/**
 * A cron cursor over the fires strictly after `after`, in the schedule's IANA
 * timezone. `cron-parser` advances from `currentDate` with strictly-after
 * semantics and resolves DST via luxon. The timezone must already be resolved
 * to a concrete zone (a `null` instance default is rejected upstream).
 * Wall-clock: a nonexistent local time (spring-forward) shifts forward; a
 * repeated local time (fall-back) fires once.
 */
function parseCron(cronExpression: CronExpression, after: Date, timezone: string): CronCursor {
	try {
		return CronExpressionParser.parse(cronExpression, {
			currentDate: after,
			tz: timezone,
		});
	} catch (error) {
		throw new InvalidScheduleError(
			`Failed to evaluate cron expression ${JSON.stringify(cronExpression)} in timezone ${JSON.stringify(timezone)}: ${(error as Error).message}`,
		);
	}
}

/** Cron: next fire strictly after `after`. */
function cronNextRun(cronExpression: CronExpression, after: Date, timezone: string): Date {
	return parseCron(cronExpression, after, timezone).next().toDate();
}

/**
 * The next anchor fire the every-Nth-period gate keeps, scanning `cursor`
 * forward from wherever it sits. `previousFire` is what the gate measures
 * elapsed periods against; off-cadence fires are consumed and skipped. Bounded
 * by a scan cap that turns a pathological anchor/gate pairing into an error
 * instead of an unbounded loop.
 */
function advanceToOnCadence(
	cursor: CronCursor,
	schedule: RecurringCronSchedule,
	previousFire: Date,
	timezone: string,
): Date {
	for (let scanned = 0; scanned < MAX_RECURRENCE_CANDIDATES; scanned++) {
		const candidate = cursor.next().toDate();
		if (isOnCadence(previousFire, candidate, schedule, timezone)) {
			return candidate;
		}
	}

	throw new InvalidScheduleError(
		`No fire of cron expression ${JSON.stringify(schedule.cronExpression)} lands on the every-${schedule.recurrenceSize}-${schedule.recurrenceUnit} cadence within ${MAX_RECURRENCE_CANDIDATES} candidates`,
	);
}

/**
 * Recurring cron: the first anchor fire after `after` that the every-Nth-period
 * gate keeps. `after` must be the previous fire — the gate measures elapsed
 * periods from it, which is what makes the cadence replayable from storage
 * alone. Off-cadence anchor fires are skipped entirely (never materialized).
 */
function recurringCronNextRun(
	schedule: RecurringCronSchedule,
	after: Date,
	timezone: string,
): Date {
	const cursor = parseCron(schedule.cronExpression, after, timezone);
	return advanceToOnCadence(cursor, schedule, after, timezone);
}

/**
 * Interval: advances by `intervalSeconds` of real elapsed time (UTC) from
 * `after` (the prior occurrence), so the cadence is deterministic and DST never
 * shifts a fire. Always strictly after `after` (intervalSeconds is positive).
 */
function intervalNextRun(schedule: IntervalSchedule, after: Date): Date {
	return new Date(after.getTime() + schedule.intervalSeconds * Time.seconds.toMilliseconds);
}

/** One-off: `fireAt` when it is strictly after `after`, otherwise `null` (exhausted). */
function oneOffNextRun(schedule: OneOffSchedule, after: Date): Date | null {
	return after.getTime() < schedule.fireAt.getTime() ? schedule.fireAt : null;
}

function resolvedTimezone(schedule: CronSchedule | RecurringCronSchedule): string {
	if (schedule.timezone === null) {
		throw new InvalidScheduleError(
			'Cron timezone must be resolved to a concrete zone before computing the next run, got null',
		);
	}
	return schedule.timezone;
}

/**
 * Compute the next occurrence strictly after `after` (a job's current
 * `nextRunAt` / last scheduled instant), as a UTC instant. This is what the
 * materializer advances `next_run_at` with.
 *
 * For `recurring_cron`, `after` is not just a lower bound: the gate measures
 * elapsed periods from it, so it must be the previous fire. Seed a fresh job
 * with {@link computeFirstRunAt}, never with an arbitrary instant fed here.
 *
 * The schedule is validated first, so malformed input (non-positive interval,
 * invalid `fireAt`, bad cron expression, unresolved `null` cron timezone) throws
 * {@link InvalidScheduleError} rather than returning a wrong or `Invalid` instant.
 *
 * Returns `null` only when the schedule is exhausted (a one-off already at or
 * past `after`); the other kinds are unbounded.
 */
export function computeNextRunAt(schedule: Schedule, after: Date): Date | null {
	validateSchedule(schedule);

	switch (schedule.kind) {
		case 'cron':
			return cronNextRun(schedule.cronExpression, after, resolvedTimezone(schedule));
		case 'recurring_cron':
			return recurringCronNextRun(schedule, after, resolvedTimezone(schedule));
		case 'interval':
			return intervalNextRun(schedule, after);
		case 'one_off':
			return oneOffNextRun(schedule, after);
		default: {
			const exhaustive: never = schedule;
			throw new InvalidScheduleError(
				`Unknown schedule kind: ${JSON.stringify((exhaustive as Schedule).kind)}`,
			);
		}
	}
}

/**
 * Compute a fresh job's first occurrence after `from` (its registration
 * instant). The one seeding API for `next_run_at`: a `recurring_cron` fires at
 * its next anchor instant with the gate ignored — there is no previous fire to
 * measure from, and `from` is not one, so gating against it would delay the
 * first fire by up to a full stride. All other kinds have no such history and
 * coincide with {@link computeNextRunAt}.
 */
export function computeFirstRunAt(schedule: Schedule, from: Date): Date | null {
	if (schedule.kind === 'recurring_cron') {
		validateSchedule(schedule);
		return cronNextRun(schedule.cronExpression, from, resolvedTimezone(schedule));
	}
	return computeNextRunAt(schedule, from);
}

/**
 * The successive occurrences of a schedule for one materialization walk, oldest
 * first, beginning with `first` (a job's current `next_run_at`: an already-due
 * fire) and continuing indefinitely until the schedule is exhausted. Validates
 * the schedule and parses any cron expression exactly once, then advances a
 * single cursor, so walking a wide window costs no repeated parsing — unlike
 * calling {@link computeNextRunAt} in a loop.
 *
 * Like {@link computeNextRunAt}, `first` for a `recurring_cron` must be a real
 * fire, not an arbitrary lower bound: the gate measures elapsed periods from
 * the previously yielded fire, so the sequence is only correct when seeded from
 * one (via {@link computeFirstRunAt}).
 */
export function* occurrencesFrom(schedule: Schedule, first: Date): Generator<Date> {
	validateSchedule(schedule);

	switch (schedule.kind) {
		case 'cron': {
			const timezone = resolvedTimezone(schedule);
			const cursor = parseCron(schedule.cronExpression, first, timezone);
			yield first;
			for (;;) {
				yield cursor.next().toDate();
			}
		}
		case 'recurring_cron': {
			const timezone = resolvedTimezone(schedule);
			const cursor = parseCron(schedule.cronExpression, first, timezone);
			let previous = first;
			yield previous;
			for (;;) {
				previous = advanceToOnCadence(cursor, schedule, previous, timezone);
				yield previous;
			}
		}
		case 'interval': {
			let previous = first;
			yield previous;
			for (;;) {
				previous = intervalNextRun(schedule, previous);
				yield previous;
			}
		}
		case 'one_off':
			// A one-off fires only at `first` (its `fireAt`); nothing follows.
			yield first;
			return;
		default: {
			const exhaustive: never = schedule;
			throw new InvalidScheduleError(
				`Unknown schedule kind: ${JSON.stringify((exhaustive as Schedule).kind)}`,
			);
		}
	}
}
