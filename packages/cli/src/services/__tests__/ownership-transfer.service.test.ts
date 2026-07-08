import type { ModuleRegistry } from '@n8n/backend-common';
import type { UserRepository } from '@n8n/db';
import type { EntityManager } from '@n8n/typeorm';
import { mock } from 'vitest-mock-extended';

import type { CredentialsService } from '@/credentials/credentials.service';
import type { DataTableService } from '@/modules/data-table/data-table.service';
import type { FolderService } from '@/services/folder.service';
import type { OwnershipService } from '@/services/ownership.service';
import type { WorkflowService } from '@/workflows/workflow.service';

import { OwnershipTransferService } from '../ownership-transfer.service';

describe('OwnershipTransferService', () => {
	const trx = mock<EntityManager>();
	const manager = mock<EntityManager>();
	const userRepository = mock<UserRepository>({ manager });
	const workflowService = mock<WorkflowService>();
	const credentialsService = mock<CredentialsService>();
	const folderService = mock<FolderService>();
	const ownershipService = mock<OwnershipService>();
	const moduleRegistry = mock<ModuleRegistry>();
	const dataTableService = mock<DataTableService>();

	let service: OwnershipTransferService;

	beforeEach(() => {
		vi.clearAllMocks();
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		manager.transaction.mockImplementation(async (cb: unknown) =>
			(cb as (trx: EntityManager) => Promise<unknown>)(trx),
		);
		workflowService.transferAll.mockResolvedValue([]);

		service = new OwnershipTransferService(
			userRepository,
			workflowService,
			credentialsService,
			folderService,
			ownershipService,
			moduleRegistry,
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.spyOn(service as any, 'getDataTableService').mockResolvedValue(dataTableService);
	});

	it('should transfer workflows, credentials and folders for each project in one transaction', async () => {
		moduleRegistry.isActive.mockReturnValue(false);

		await service.transferAllResources(['from-1', 'from-2'], 'to');

		expect(manager.transaction).toHaveBeenCalledTimes(1);
		for (const fromProjectId of ['from-1', 'from-2']) {
			expect(workflowService.transferAll).toHaveBeenCalledWith(fromProjectId, 'to', trx);
			expect(credentialsService.transferAll).toHaveBeenCalledWith(fromProjectId, 'to', trx);
			expect(folderService.transferAllFoldersToProject).toHaveBeenCalledWith(
				fromProjectId,
				'to',
				trx,
			);
		}
	});

	it('should invalidate the workflow ownership cache for all transferred workflows', async () => {
		moduleRegistry.isActive.mockReturnValue(false);
		workflowService.transferAll
			.mockResolvedValueOnce(['wf-1', 'wf-2'])
			.mockResolvedValueOnce(['wf-3']);

		await service.transferAllResources(['from-1', 'from-2'], 'to');

		expect(ownershipService.invalidateWorkflowProjectCacheByIds).toHaveBeenCalledWith([
			'wf-1',
			'wf-2',
			'wf-3',
		]);
	});

	it('should transfer data tables for each project when the module is active', async () => {
		moduleRegistry.isActive.mockReturnValue(true);

		await service.transferAllResources(['from-1', 'from-2'], 'to');

		expect(dataTableService.transferDataTablesByProjectId).toHaveBeenCalledWith('from-1', 'to');
		expect(dataTableService.transferDataTablesByProjectId).toHaveBeenCalledWith('from-2', 'to');
	});

	it('should invalidate the cache before transferring data tables, so a data-table failure cannot leave the cache stale', async () => {
		moduleRegistry.isActive.mockReturnValue(true);
		workflowService.transferAll.mockResolvedValueOnce(['wf-1']);
		dataTableService.transferDataTablesByProjectId.mockRejectedValueOnce(new Error('boom'));

		await expect(service.transferAllResources(['from-1'], 'to')).rejects.toThrow('boom');

		expect(ownershipService.invalidateWorkflowProjectCacheByIds).toHaveBeenCalledWith(['wf-1']);
	});

	it('should skip data tables when the module is inactive', async () => {
		moduleRegistry.isActive.mockReturnValue(false);

		await service.transferAllResources(['from-1'], 'to');

		expect(dataTableService.transferDataTablesByProjectId).not.toHaveBeenCalled();
	});
});
