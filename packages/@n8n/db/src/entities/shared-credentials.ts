import { CredentialSharingRole } from '@n8n/permissions';
import { Column, Entity, ManyToOne, PrimaryColumn } from '@n8n/typeorm';

import { WithTimestamps } from './abstract-entity';
import { CredentialsEntity } from './credentials-entity';
import { Project } from './project';

@Entity()
// eslint-disable-next-line n8n-local-rules/project-owned-entity-transfer -- covered: transferred by OwnershipTransferService.transferAllResources()
export class SharedCredentials extends WithTimestamps {
	@Column({ type: 'varchar' })
	role: CredentialSharingRole;

	@ManyToOne('CredentialsEntity', 'shared')
	credentials: CredentialsEntity;

	@PrimaryColumn()
	credentialsId: string;

	@ManyToOne('Project', 'sharedCredentials')
	project: Project;

	@PrimaryColumn()
	projectId: string;
}
