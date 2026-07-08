/* eslint-disable @typescript-eslint/naming-convention */
/**
 * The durable scheduler's shared vocabulary: recurrence kinds and the task
 * lifecycle. Defined here — a leaf package both sides already depend on — so
 * `@n8n/scheduler` (the domain and algorithms) and `@n8n/db` (the schema:
 * column defaults, CHECK constraints) share one definition without a package
 * cycle.
 */

/**
 * Recurrence kind of a scheduled job.
 * It selects which schedule columns apply.
 */
export const ScheduledJobKind = {
	Cron: 'cron',
	Interval: 'interval',
	OneOff: 'one_off',
	RecurringCron: 'recurring_cron',
} as const;

export type ScheduledJobKind = (typeof ScheduledJobKind)[keyof typeof ScheduledJobKind];

/** All recurrence kinds as a runtime list. */
export const ScheduledJobKindList = Object.values(ScheduledJobKind);

/**
 * Calendar period a `recurring_cron` job's every-Nth-period gate counts in.
 * Seconds and minutes are absent by design: a cron step expresses those
 * directly, so they never need a gate.
 */
export const ScheduledJobRecurrenceUnit = {
	Hours: 'hours',
	Days: 'days',
	Weeks: 'weeks',
	Months: 'months',
} as const;

export type ScheduledJobRecurrenceUnit =
	(typeof ScheduledJobRecurrenceUnit)[keyof typeof ScheduledJobRecurrenceUnit];

/** All recurrence units as a runtime list. */
export const ScheduledJobRecurrenceUnitList = Object.values(ScheduledJobRecurrenceUnit);

/**
 * Where a scheduled task is in its lifecycle, from waiting to run to a final outcome.
 */
export const ScheduledTaskStatus = {
	Pending: 'pending',
	Running: 'running',
	Succeeded: 'succeeded',
	Failed: 'failed',
	Missed: 'missed',
	Cancelled: 'cancelled',
} as const;

export type ScheduledTaskStatus = (typeof ScheduledTaskStatus)[keyof typeof ScheduledTaskStatus];

/** All statuses as a runtime list. */
export const ScheduledTaskStatusList = Object.values(ScheduledTaskStatus);

/** Statuses of finished work: the only rows retention may delete. */
export const TerminalTaskStatusList = [
	ScheduledTaskStatus.Succeeded,
	ScheduledTaskStatus.Failed,
	ScheduledTaskStatus.Missed,
	ScheduledTaskStatus.Cancelled,
] as const;

export type TerminalTaskStatus = (typeof TerminalTaskStatusList)[number];
