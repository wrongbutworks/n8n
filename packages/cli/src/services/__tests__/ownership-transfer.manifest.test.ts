import { getMetadataArgsStorage } from '@n8n/typeorm';
import { readdirSync } from 'node:fs';
import path from 'node:path';

// Register core entity decorators
import '@n8n/db';

import {
	TRANSFERRED_PROJECT_RESOURCES,
	NOT_TRANSFERRED_PROJECT_RESOURCES,
} from '../ownership-transfer.manifest';

function findEntityFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true, recursive: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.entity.ts'))
		.map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * Guard for IAM-898: every entity that belongs to a Project must be explicitly
 * accounted for in the ownership-transfer manifest, so that adding a new
 * project-owned resource cannot silently drop user data on user deletion.
 *
 * If this test fails with an unhandled entity: handle it in
 * `OwnershipTransferService.transferAllResources()` and add it to
 * `TRANSFERRED_PROJECT_RESOURCES`, or consciously exclude it with a reason in
 * `NOT_TRANSFERRED_PROJECT_RESOURCES`.
 */
describe('ownership-transfer manifest', () => {
	const projectOwnedEntityNames = new Set<string>();
	let moduleEntityFileCount = 0;

	beforeAll(async () => {
		// Register module entity decorators via the filesystem so that a newly
		// added module entity is picked up without editing this test.
		const moduleEntityFiles = findEntityFiles(path.resolve(__dirname, '../../modules'));
		moduleEntityFileCount = moduleEntityFiles.length;
		await Promise.all(moduleEntityFiles.map(async (file) => await import(file)));

		const storage = getMetadataArgsStorage();
		const entityTargets = new Set(
			storage.tables.map((t) => t.target).filter((t): t is Function => typeof t === 'function'),
		);

		for (const relation of storage.relations) {
			if (typeof relation.target !== 'function' || !entityTargets.has(relation.target)) continue;
			const relationType =
				typeof relation.type === 'function' && !entityTargets.has(relation.type as Function)
					? (relation.type as () => unknown)()
					: relation.type;
			const typeName = typeof relationType === 'function' ? relationType.name : relationType;
			if (typeName === 'Project' && relation.target.name !== 'Project') {
				projectOwnedEntityNames.add(relation.target.name);
			}
		}

		for (const column of storage.columns) {
			if (typeof column.target !== 'function' || !entityTargets.has(column.target)) continue;
			if (column.propertyName === 'projectId' && column.target.name !== 'Project') {
				projectOwnedEntityNames.add(column.target.name);
			}
		}
	}, 120_000);

	const manifestNames = new Set<string>([
		...TRANSFERRED_PROJECT_RESOURCES,
		...Object.keys(NOT_TRANSFERRED_PROJECT_RESOURCES),
	]);

	it('registers module entities', () => {
		expect(moduleEntityFileCount).toBeGreaterThan(0);
	});

	it('detects known project-owned entities', () => {
		// sanity check that metadata reflection works at all
		expect(projectOwnedEntityNames).toContain('SharedWorkflow');
	});

	it('accounts for every project-owned entity', () => {
		const unhandled = [...projectOwnedEntityNames].filter((name) => !manifestNames.has(name));
		expect(unhandled.sort()).toEqual([]);
	});

	it('has no stale manifest entries', () => {
		const stale = [...manifestNames].filter((name) => !projectOwnedEntityNames.has(name));
		expect(stale.sort()).toEqual([]);
	});

	it('lists each entity in only one category', () => {
		const overlap = TRANSFERRED_PROJECT_RESOURCES.filter(
			(name) => name in NOT_TRANSFERRED_PROJECT_RESOURCES,
		);
		expect(overlap).toEqual([]);
	});
});
