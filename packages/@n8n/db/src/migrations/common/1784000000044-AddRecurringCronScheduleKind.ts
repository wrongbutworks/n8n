import { TableCheck } from '@n8n/typeorm';

import type { IrreversibleMigration, MigrationContext } from '../migration-types';

const table = 'scheduled_job';
const kindColumn = 'kind';
const kindValues = ['cron', 'interval', 'one_off', 'recurring_cron'];
const recurrenceUnitValues = ['hours', 'days', 'weeks', 'months'];

/**
 * Adds the `recurring_cron` schedule kind: a cron anchor thinned by an
 * every-Nth-period gate, for cadences cron alone cannot express ("every 3
 * weeks on Mon and Wed"). The anchor reuses the existing `cronExpression` /
 * `timezone` columns; the gate lives in the two new columns.
 *
 * Irreversible for the same reason as `AllowAzureStoredAt`: a faithful `down`
 * would have to narrow the kind CHECK back, which means deleting any
 * `recurring_cron` rows created after this ran.
 */
export class AddRecurringCronScheduleKind1784000000044 implements IrreversibleMigration {
	async up(context: MigrationContext) {
		await this.addRecurrenceColumns(context);

		await context.queryRunner.getTable(`${context.tablePrefix}${table}`);

		await this.widenKindCheck(context);
		await this.addRecurringCronPresenceCheck(context);
		if (context.isPostgres) {
			await this.commentColumns(context);
		}
	}

	/**
	 * Raw `ADD COLUMN` (not the DSL's `addColumns`) so SQLite does not recreate
	 * the table for a pair of nullable columns. The column CHECKs apply to any
	 * row that sets them, whatever its kind.
	 */
	private async addRecurrenceColumns({ runQuery, escape, tablePrefix }: MigrationContext) {
		const jobTable = escape.tableName(table);
		const recurrenceUnit = escape.columnName('recurrenceUnit');
		const recurrenceSize = escape.columnName('recurrenceSize');

		const unitValues = recurrenceUnitValues.map((value) => `'${value}'`).join(', ');
		await runQuery(
			`ALTER TABLE ${jobTable} ADD COLUMN ${recurrenceUnit} varchar(16) ` +
				`CONSTRAINT "CHK_${tablePrefix}scheduled_job_recurrence_unit" CHECK (${recurrenceUnit} IN (${unitValues}))`,
		);
		await runQuery(
			`ALTER TABLE ${jobTable} ADD COLUMN ${recurrenceSize} int ` +
				`CONSTRAINT "CHK_${tablePrefix}scheduled_job_recurrence_size" CHECK (${recurrenceSize} >= 2)`,
		);
	}

	/**
	 * Widen the kind enum CHECK to accept the new value (recreates the table on
	 * SQLite). The original check came from the DSL's `withEnumCheck`, so
	 * `dropEnumCheck` finds it by its deterministic name.
	 */
	private async widenKindCheck({ schemaBuilder }: MigrationContext) {
		await schemaBuilder.dropEnumCheck(table, kindColumn, { recreatesOnSqlite: true });
		await schemaBuilder.addEnumCheck(table, kindColumn, kindValues, { recreatesOnSqlite: true });
	}

	private async addRecurringCronPresenceCheck({ queryRunner, tablePrefix }: MigrationContext) {
		await queryRunner.createCheckConstraint(
			`${tablePrefix}${table}`,
			new TableCheck({
				name: `CHK_${tablePrefix}scheduled_job_recurring_cron`,
				expression:
					'"kind" <> \'recurring_cron\' OR ("cronExpression" IS NOT NULL AND "recurrenceUnit" IS NOT NULL AND "recurrenceSize" IS NOT NULL)',
			}),
		);
	}

	private async commentColumns({ runQuery, escape }: MigrationContext) {
		const jobTable = escape.tableName(table);
		await runQuery(
			`COMMENT ON COLUMN ${jobTable}.${escape.columnName('recurrenceUnit')} IS ` +
				"'Calendar period of the every-Nth-period recurrence gate; set only when kind is ''recurring_cron''.'",
		);
		await runQuery(
			`COMMENT ON COLUMN ${jobTable}.${escape.columnName('recurrenceSize')} IS ` +
				"'The N of the every-Nth-period recurrence gate, at least 2; set only when kind is ''recurring_cron''.'",
		);
		await runQuery(
			`COMMENT ON COLUMN ${jobTable}.${escape.columnName('cronExpression')} IS ` +
				"'Cron expression driving recurrence; set when kind is ''cron'' or ''recurring_cron'' (where it is the anchor the recurrence gate thins).'",
		);
	}
}
