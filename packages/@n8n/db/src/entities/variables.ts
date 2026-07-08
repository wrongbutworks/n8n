import { Column, Entity, ManyToOne } from '@n8n/typeorm';

import { WithStringId } from './abstract-entity';
import type { Project } from './project';

@Entity()
// eslint-disable-next-line n8n-local-rules/project-owned-entity-transfer -- excluded: project-scoped variables are dropped via FK cascade
export class Variables extends WithStringId {
	@Column('text')
	key: string;

	@Column('text', { default: 'string' })
	type: string;

	@Column('text')
	value: string;

	// If null, it's a global variable
	@ManyToOne('Project', {
		onDelete: 'CASCADE',
		nullable: true,
	})
	project: Project | null;
}
