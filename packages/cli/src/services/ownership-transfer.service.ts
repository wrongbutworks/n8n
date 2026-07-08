import { ModuleRegistry } from '@n8n/backend-common';
import { UserRepository } from '@n8n/db';
import { Container, Service } from '@n8n/di';

import { CredentialsService } from '@/credentials/credentials.service';
import { FolderService } from '@/services/folder.service';
import { OwnershipService } from '@/services/ownership.service';
import { WorkflowService } from '@/workflows/workflow.service';

/**
 * The single place where a project's resources change owner (user deletion
 * with transfer, LDAP reset). Every project-owned resource type must be
 * handled here and listed in `ownership-transfer.manifest.ts` — enforced by
 * the manifest guard test and the `project-owned-entity-transfer` lint rule.
 */
@Service()
export class OwnershipTransferService {
	constructor(
		private readonly userRepository: UserRepository,
		private readonly workflowService: WorkflowService,
		private readonly credentialsService: CredentialsService,
		private readonly folderService: FolderService,
		private readonly ownershipService: OwnershipService,
		private readonly moduleRegistry: ModuleRegistry,
	) {}

	private async getDataTableService() {
		const { DataTableService } = await import('@/modules/data-table/data-table.service');
		return Container.get(DataTableService);
	}

	/**
	 * Transfer all resources owned by the given projects to the destination
	 * project. Workflows, credentials and folders move in a single transaction;
	 * module-owned resources (data tables) and post-commit side effects (cache
	 * invalidation) follow after the transaction commits.
	 */
	async transferAllResources(fromProjectIds: string[], toProjectId: string): Promise<void> {
		const transferredWorkflowIds: string[] = [];

		await this.userRepository.manager.transaction(async (trx) => {
			for (const fromProjectId of fromProjectIds) {
				transferredWorkflowIds.push(
					...(await this.workflowService.transferAll(fromProjectId, toProjectId, trx)),
				);
				await this.credentialsService.transferAll(fromProjectId, toProjectId, trx);
				await this.folderService.transferAllFoldersToProject(fromProjectId, toProjectId, trx);
			}
		});

		if (this.moduleRegistry.isActive('data-table')) {
			const dataTableService = await this.getDataTableService();
			for (const fromProjectId of fromProjectIds) {
				await dataTableService.transferDataTablesByProjectId(fromProjectId, toProjectId);
			}
		}

		// The transfer re-homed these workflows, so their cached owner project is
		// stale; invalidate after commit so ownership lookups re-read the DB.
		await this.ownershipService.invalidateWorkflowProjectCacheByIds(transferredWorkflowIds);
	}
}
