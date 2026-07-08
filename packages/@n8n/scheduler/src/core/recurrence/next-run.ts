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

/**
 * Cron: next fire strictly after `after`, in the schedule's IANA timezone.
 * `cron-parser` advances from `currentDate` with strictly-after semantics and
 * resolves DST via luxon. The timezone must already be resolved to a concrete
 * zone (a `null` instance default is rejected upstream). Wall-clock: a
 * nonexistent local time (spring-forward) shifts forward; a repeated local time
 * (fall-back) fires once.
 */
function cronNextRun(cronExpression: CronExpression, after: Date, timezone: string): Date {
	try {
		const it = CronExpressionParser.parse(cronExpression, {
			currentDate: after,
			tz: timezone,
		});
		return it.next().toDate();
	} catch (error) {
		throw new InvalidScheduleError(
			`Failed to evaluate cron expression ${JSON.stringify(cronExpression)} in timezone ${JSON.stringify(timezone)}: ${(error as Error).message}`,
		);
	}
}

/**
 * Recurring cron: the first anchor fire after `after` that the every-Nth-period
 * gate keeps. `after` must be the previous fire — the gate measures elapsed
 * periods from it, which is what makes the cadence replayable from storage
 * alone. Off-cadence anchor fires are skipped entirely (never materialized),
 * under a scan bound that turns a pathological anchor/gate pairing into an
 * error instead of an unbounded loop.
 */
function recurringCronNextRun(
	schedule: RecurringCronSchedule,
	after: Date,
	timezone: string,
): Date {
	let it;
	try {
		it = CronExpressionParser.parse(schedule.cronExpression, {
			currentDate: after,
			tz: timezone,
		});
	} catch (error) {
		throw new InvalidScheduleError(
			`Failed to evaluate cron expression ${JSON.stringify(schedule.cronExpression)} in timezone ${JSON.stringify(timezone)}: ${(error as Error).message}`,
		);
	}

	for (let scanned = 0; scanned < MAX_RECURRENCE_CANDIDATES; scanned++) {
		const candidate = it.next().toDate();
		if (isOnCadence(after, candidate, schedule, timezone)) {
			return candidate;
		}
	}

	throw new InvalidScheduleError(
		`No fire of cron expression ${JSON.stringify(schedule.cronExpression)} lands on the every-${schedule.recurrenceSize}-${schedule.recurrenceUnit} cadence within ${MAX_RECURRENCE_CANDIDATES} candidates`,
	);
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
