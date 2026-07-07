import { Service } from '@n8n/di';

import { WorkflowPackageImporter } from './workflow-package-importer';
import { N8nPackageParser } from './n8n-package-parser';
import { TarPackageReader } from '../io/tar/tar-package-reader';
import { PackageImportConfig } from '../n8n-packages.config';
import type { ImportPackageRequest, ImportResult } from '../n8n-packages.types';

/** Reads the manifest and delegates to the workflow-package importer. */
@Service()
export class ImportPipeline {
	constructor(
		private readonly packageParser: N8nPackageParser,
		private readonly packageImportConfig: PackageImportConfig,
		private readonly workflowPackageImporter: WorkflowPackageImporter,
	) {}

	async run(request: ImportPackageRequest): Promise<ImportResult> {
		const reader = new TarPackageReader(request.packageBuffer, this.packageImportConfig);
		const manifest = await this.packageParser.getManifest(reader);

		return await this.workflowPackageImporter.import(request, reader, manifest);
	}
}
