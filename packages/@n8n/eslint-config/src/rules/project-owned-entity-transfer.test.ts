import { RuleTester } from '@typescript-eslint/rule-tester';
import { ProjectOwnedEntityTransferRule } from './project-owned-entity-transfer.js';

const ruleTester = new RuleTester();

// NOTE: acknowledging a decision is done with a standard
// `eslint-disable-next-line n8n-local-rules/project-owned-entity-transfer -- <decision>`
// comment on the class line. RuleTester does not process disable directives,
// so the valid cases below only cover classes the rule must not flag at all.
ruleTester.run('project-owned-entity-transfer', ProjectOwnedEntityTransferRule, {
	valid: [
		// Entity without any Project reference needs no decision
		{
			code: `
				@Entity()
				export class Webhook {
					@Column()
					method: string;
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
		// projectId column
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
		// arrow-function relation to Project
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
		// string-form relation to Project
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
		// many-to-many relation to Project
		{
			code: `
				@Entity()
				export class RoleMappingRule {
					@ManyToMany('Project', (project: Project) => project.roleMappingRules)
					projects: Project[];
				}
			`,
			errors: [{ messageId: 'missingTransferDecision' }],
		},
	],
});
