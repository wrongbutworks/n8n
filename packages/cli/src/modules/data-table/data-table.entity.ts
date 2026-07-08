import { Project, WithTimestampsAndStringId } from '@n8n/db';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from '@n8n/typeorm';

import { DataTableColumn } from './data-table-column.entity';

@Entity()
@Index(['name', 'projectId'], { unique: true })
// eslint-disable-next-line n8n-local-rules/project-owned-entity-transfer -- covered: transferred by OwnershipTransferService.transferAllResources()
export class DataTable extends WithTimestampsAndStringId {
	constructor() {
		super();
	}

	@Column()
	name: string;

	@OneToMany(
		() => DataTableColumn,
		(dataTableColumn) => dataTableColumn.dataTable,
		{
			cascade: true,
		},
	)
	columns: DataTableColumn[];

	@ManyToOne(() => Project)
	@JoinColumn({ name: 'projectId' })
	project: Project;

	@Column()
	projectId: string;
}
