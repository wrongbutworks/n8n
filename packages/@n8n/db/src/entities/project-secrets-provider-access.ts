import { Column, Entity, ManyToOne, PrimaryColumn } from '@n8n/typeorm';

import { WithTimestamps } from './abstract-entity';
import { Project } from './project';
import { SecretsProviderConnection } from './secrets-provider-connection';

export type SecretsProviderAccessRole =
	| 'secretsProviderConnection:owner'
	| 'secretsProviderConnection:user';

@Entity()
// eslint-disable-next-line n8n-local-rules/project-owned-entity-transfer -- excluded: per-project secrets-provider config, scoped to the deleted project
export class ProjectSecretsProviderAccess extends WithTimestamps {
	@ManyToOne('SecretsProviderConnection', 'projectAccess')
	secretsProviderConnection: SecretsProviderConnection;

	@PrimaryColumn()
	secretsProviderConnectionId: number;

	@ManyToOne('Project', 'secretsProviderAccess', { eager: true })
	project: Project;

	@PrimaryColumn()
	projectId: string;

	@Column({ type: 'varchar', length: 128, default: 'secretsProviderConnection:user' })
	role: SecretsProviderAccessRole;
}
