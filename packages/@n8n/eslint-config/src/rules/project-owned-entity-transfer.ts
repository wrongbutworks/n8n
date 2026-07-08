import { ESLintUtils, TSESTree } from '@typescript-eslint/utils';

const RELATION_DECORATORS = new Set(['ManyToOne', 'OneToOne', 'ManyToMany']);

function isEntityClass(node: TSESTree.ClassDeclaration): boolean {
	return node.decorators.some(
		(decorator) =>
			decorator.expression.type === TSESTree.AST_NODE_TYPES.CallExpression &&
			decorator.expression.callee.type === TSESTree.AST_NODE_TYPES.Identifier &&
			decorator.expression.callee.name === 'Entity',
	);
}

function referencesProject(decorator: TSESTree.Decorator): boolean {
	const { expression } = decorator;
	if (
		expression.type !== TSESTree.AST_NODE_TYPES.CallExpression ||
		expression.callee.type !== TSESTree.AST_NODE_TYPES.Identifier ||
		!RELATION_DECORATORS.has(expression.callee.name)
	) {
		return false;
	}
	const [firstArg] = expression.arguments;
	if (!firstArg) return false;
	// @ManyToOne(() => Project, ...)
	if (
		firstArg.type === TSESTree.AST_NODE_TYPES.ArrowFunctionExpression &&
		firstArg.body.type === TSESTree.AST_NODE_TYPES.Identifier &&
		firstArg.body.name === 'Project'
	) {
		return true;
	}
	// @ManyToOne('Project', ...)
	return firstArg.type === TSESTree.AST_NODE_TYPES.Literal && firstArg.value === 'Project';
}

function isProjectOwned(node: TSESTree.ClassDeclaration): boolean {
	return node.body.body.some((member) => {
		if (member.type !== TSESTree.AST_NODE_TYPES.PropertyDefinition) return false;
		if (member.key.type === TSESTree.AST_NODE_TYPES.Identifier && member.key.name === 'projectId') {
			return true;
		}
		return member.decorators.some(referencesProject);
	});
}

/**
 * Flags every project-owned entity so that the author must make an explicit
 * ownership-transfer decision. To acknowledge, handle the entity in
 * `OwnershipTransferService`, list it in the ownership-transfer manifest, and
 * suppress the report with a standard
 * `eslint-disable-next-line ... -- <decision>` comment stating the decision.
 */
export const ProjectOwnedEntityTransferRule = ESLintUtils.RuleCreator.withoutDocs({
	meta: {
		type: 'problem',
		docs: {
			description:
				'Require every project-owned entity to record an explicit decision about how it is handled when a project’s resources are transferred to another owner (user deletion with transfer, LDAP reset). Prevents silently dropping user data when a new resource type is added (IAM-898).',
		},
		messages: {
			missingTransferDecision:
				'Entity `{{ name }}` belongs to a Project. Decide how it is handled when a project’s resources are transferred: handle it in `OwnershipTransferService.transferAllResources()` and list it in `packages/cli/src/services/ownership-transfer.manifest.ts`, then record the decision with an `// eslint-disable-next-line n8n-local-rules/project-owned-entity-transfer -- <covered or excluded: reason>` comment on the class.',
		},
		schema: [],
	},
	defaultOptions: [],
	create(context) {
		return {
			ClassDeclaration(node) {
				if (!isEntityClass(node) || !isProjectOwned(node)) return;
				if (node.id?.name === 'Project') return;

				context.report({
					node: node.id ?? node,
					messageId: 'missingTransferDecision',
					data: { name: node.id?.name ?? '<anonymous>' },
				});
			},
		};
	},
});
