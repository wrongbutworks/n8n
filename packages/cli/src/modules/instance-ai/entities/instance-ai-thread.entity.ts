import { WithTimestamps, JsonColumn, Project } from '@n8n/db';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from '@n8n/typeorm';

@Entity({ name: 'instance_ai_threads' })
// eslint-disable-next-line n8n-local-rules/project-owned-entity-transfer -- excluded: AI assistant conversation history, personal to the deleted user
export class InstanceAiThread extends WithTimestamps {
	@PrimaryColumn('uuid')
	id: string;

	@Index()
	@Column({ type: 'varchar', length: 255 })
	resourceId: string;

	@ManyToOne(() => Project, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'projectId' })
	project: Project;

	@Index()
	@Column({ type: 'varchar', length: 36 })
	projectId: string;

	@Column({ type: 'text', default: '' })
	title: string;

	@JsonColumn({ nullable: true })
	metadata: Record<string, unknown> | null;
}
