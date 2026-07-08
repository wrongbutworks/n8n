import { Column, Entity, ManyToOne } from '@n8n/typeorm';

import { WithStringId } from './abstract-entity';
import type { Project } from './project';

// @ownershipTransfer excluded — project-scoped variables are dropped via FK cascade; personal projects do not expose them
@Entity()
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
