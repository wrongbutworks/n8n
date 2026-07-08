import { ScheduledJobRecurrenceUnitList } from '@n8n/constants';
import { CronExpressionParser } from 'cron-parser';
import { IANAZone } from 'luxon';

import { InvalidScheduleError } from '../errors';
import type {
	CronSchedule,
	IntervalSchedule,
	OneOffSchedule,
	RecurringCronSchedule,
	Schedule,
} from '../types';

/** Cron expressions are required to be 6-field (with a leading seconds field). */
const CRON_FIELD_COUNT = 6;

function validateCron(schedule: CronSchedule | RecurringCronSchedule): void {
	// This is the boundary for raw, possibly-untyped input (DB rows), so guard the
	// runtime type before using it instead of throwing a raw TypeError.
	const expression: unknown = schedule.cronExpression;
	if (typeof expression !== 'string') {
		throw new InvalidScheduleError(
			`${schedule.kind}.cronExpression must be a string, got ${JSON.stringify(expression)}`,
		);
	}

	const fieldCount = expression.trim().split(/\s+/).length;
	if (fieldCount !== CRON_FIELD_COUNT) {
		throw new InvalidScheduleError(
			`Cron expression must have ${CRON_FIELD_COUNT} fields (seconds included), got ${fieldCount}: ${JSON.stringify(expression)}`,
		);
	}

	// A null timezone is the instance default, resolved by the caller.
	if (schedule.timezone !== null && !IANAZone.isValidZone(schedule.timezone)) {
		throw new InvalidScheduleError(`Unknown IANA timezone: ${JSON.stringify(schedule.timezone)}`);
	}

	try {
		CronExpressionParser.parse(expression, {
			tz: schedule.timezone ?? 'UTC',
		});
	} catch (error) {
		throw new InvalidScheduleError(
			`Invalid cron expression ${JSON.stringify(expression)}: ${(error as Error).message}`,
		);
	}
}

/**
 * The gate's stride is a generic integer >= 2: a stride of 1 is the anchor's
 * own cadence and must be expressed as a plain `cron`. Rule-level ranges (an
 * hours stride below 24, a days stride below 32) belong to whoever authors the
 * rule, not the schedule math, which is correct for any stride.
 */
function validateRecurringCron(schedule: RecurringCronSchedule): void {
	validateCron(schedule);

	if (!ScheduledJobRecurrenceUnitList.includes(schedule.recurrenceUnit)) {
		throw new InvalidScheduleError(
			`recurring_cron.recurrenceUnit must be one of ${ScheduledJobRecurrenceUnitList.join(', ')}, got ${JSON.stringify(schedule.recurrenceUnit)}`,
		);
	}

	if (!Number.isInteger(schedule.recurrenceSize) || schedule.recurrenceSize < 2) {
		throw new InvalidScheduleError(
			`recurring_cron.recurrenceSize must be an integer of at least 2 (a stride of 1 is a plain cron), got ${JSON.stringify(schedule.recurrenceSize)}`,
		);
	}
}

function validateInterval(schedule: IntervalSchedule): void {
	if (!Number.isInteger(schedule.intervalSeconds) || schedule.intervalSeconds <= 0) {
		throw new InvalidScheduleError(
			`interval.intervalSeconds must be a positive integer, got ${JSON.stringify(schedule.intervalSeconds)}`,
		);
	}
}

function validateOneOff(schedule: OneOffSchedule): void {
	const fireAt: unknown = schedule.fireAt;
	if (!(fireAt instanceof Date) || Number.isNaN(fireAt.getTime())) {
		throw new InvalidScheduleError('one_off.fireAt must be a valid Date');
	}
}

/**
 * Validate a schedule definition, throwing {@link InvalidScheduleError} on the
 * first problem. Safe to call before persisting a schedule or computing its next
 * run.
 */
export function validateSchedule(schedule: Schedule): void {
	switch (schedule.kind) {
		case 'cron':
			return validateCron(schedule);
		case 'recurring_cron':
			return validateRecurringCron(schedule);
		case 'interval':
			return validateInterval(schedule);
		case 'one_off':
			return validateOneOff(schedule);
		default: {
			const exhaustive: never = schedule;
			throw new InvalidScheduleError(
				`Unknown schedule kind: ${JSON.stringify((exhaustive as Schedule).kind)}`,
			);
		}
	}
}
