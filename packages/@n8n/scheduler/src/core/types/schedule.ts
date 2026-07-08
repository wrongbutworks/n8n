import type { ScheduledJobKind, ScheduledJobRecurrenceUnit } from '@n8n/constants';
import type { CronExpression } from 'n8n-workflow';

/**
 * The recurrence source: a `ScheduledJob` defines recurring work through a cron /
 * interval / one-off rule, which the materialiser turns into tasks. Time
 * and DST math over these types lives in `recurrence/`; coordination (the core)
 * never looks at them.
 *
 * `CronExpression` is imported from `n8n-workflow` (its canonical home) and not
 * re-exported here.
 */

/**
 * A 6-field cron expression (seconds included) evaluated in an IANA timezone.
 * Wall-clock: fires at the given local time, so DST shifts the absolute instant.
 * `timezone === null` means the instance default, resolved by the caller before
 * the math runs.
 */
export interface CronSchedule {
	kind: 'cron';
	cronExpression: CronExpression;
	timezone: string | null;
}

/**
 * A fixed-period schedule firing every `intervalSeconds`, measured as absolute
 * elapsed time (UTC) from the prior occurrence, so DST never shifts a fire. No
 * timezone field by design.
 */
export interface IntervalSchedule {
	kind: 'interval';
	intervalSeconds: number;
}

/** Fires exactly once at `fireAt`, then never again. A fixed instant: no tz/DST concern. */
export interface OneOffSchedule {
	kind: 'one_off';
	fireAt: Date;
}

/**
 * A cron anchor thinned by an every-Nth-period gate, for cadences cron alone
 * cannot express ("every 3 weeks on Mon and Wed", "every 5 hours"). The anchor
 * places fires within a period and may deliberately over-produce candidates;
 * the gate keeps a candidate only when `recurrenceSize` or more wall-clock
 * periods have elapsed since the previous fire (or zero, so a multi-position
 * anchor fires each of its positions within one on-cadence period). Unlike
 * plain cron, the next fire therefore depends on the previous one: `after`
 * passed to the math must be the previous fire, not an arbitrary instant.
 */
export interface RecurringCronSchedule {
	kind: 'recurring_cron';
	cronExpression: CronExpression;
	timezone: string | null;
	recurrenceUnit: ScheduledJobRecurrenceUnit;
	/** Integer >= 2: a stride of 1 is the anchor's own cadence, i.e. a plain cron. */
	recurrenceSize: number;
}

export type Schedule = CronSchedule | IntervalSchedule | OneOffSchedule | RecurringCronSchedule;

export interface ScheduledJob {
	id: number;
	taskType: string;
	payload: Record<string, unknown>;
	kind: ScheduledJobKind;
	/** Set only when {@link kind} is `cron` or `recurring_cron`. */
	cronExpression: string | null;
	/** IANA zone a cron expression is evaluated in; `null` means the instance default. */
	timezone: string | null;
	/** Set only when {@link kind} is `interval`. */
	intervalSeconds: number | null;
	/** Set only when {@link kind} is `one_off`. */
	fireAt: Date | null;
	/** Set only when {@link kind} is `recurring_cron`. */
	recurrenceUnit: ScheduledJobRecurrenceUnit | null;
	/** Set only when {@link kind} is `recurring_cron`. */
	recurrenceSize: number | null;
	nextRunAt: Date | null; // the next instant the materializer materializes from.
	lastFiredAt: Date | null;
	maxAttempts: number;
}
