import { RuleTester } from '@typescript-eslint/rule-tester';
import { ProjectOwnedEntityTransferRule } from './project-owned-entity-transfer.js';

const ruleTester = new RuleTester();

ruleTester.run('project-owned-entity-transfer', ProjectOwnedEntityTransferRule, {
	valid: [
		// Entity without any Project reference needs no marker
		{
			code: `
				@Entity()
				export class Webhook {
					@Column()
					method: string;
				}
			`,
		},
		// Project-owned entity with a marker comment is fine
		{
			code: `
				// @ownershipTransfer covered — transferred by OwnershipTransferService
				@Entity()
				export class SharedWorkflow {
					@Column()
					projectId: string;
				}
			`,
		},
		// Marker also satisfies relation-based ownership, string form included
		{
			code: `
				// @ownershipTransfer excluded — dropped via FK cascade, personal projects have none
				@Entity()
				export class Variables {
					@ManyToOne('Project', { nullable: true })
					project: Project | null;
				}
			`,
		},
		// The Project entity itself is not "project-owned"
		{
			code: `
				@Entity()
				export class Project {
					@Column()
					name: string;
				}
			`,
		},
		// Non-entity class with projectId is ignored
		{
			code: `
				export class SomeDto {
					projectId: string;
				}
			`,
		},
	],
	invalid: [
		// projectId column without a marker
		{
			code: `
				@Entity()
				export class DataTable {
					@Column()
					projectId: string;
				}
			`,
			errors: [{ messageId: 'missingTransferDecision' }],
		},
		// arrow-function relation to Project without a marker
		{
			code: `
				@Entity()
				export class Agent {
					@ManyToOne(() => Project, { onDelete: 'CASCADE' })
					project: Project;
				}
			`,
			errors: [{ messageId: 'missingTransferDecision' }],
		},
		// string-form relation to Project without a marker
		{
			code: `
				@Entity()
				export class Variables {
					@ManyToOne('Project', { nullable: true })
					project: Project | null;
				}
			`,
			errors: [{ messageId: 'missingTransferDecision' }],
		},
	],
});
