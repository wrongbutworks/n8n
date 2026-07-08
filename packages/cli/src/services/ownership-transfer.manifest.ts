/**
 * Manifest of project-owned entities and how they are handled when a project's
 * resources change owner (user deletion with transfer, LDAP reset).
 *
 * Every entity that references a `Project` (a `projectId` column or a relation
 * to `Project`) MUST be listed in exactly one of the two lists below. This is
 * enforced by `__tests__/ownership-transfer.manifest.test.ts` and by the
 * `n8n-local-rules/project-owned-entity-transfer` lint rule, so that adding a
 * new project-owned resource forces an explicit decision instead of silently
 * dropping user data (see IAM-898, where data tables were lost this way).
 */

/** Entity class names transferred by {@link OwnershipTransferService.transferAllResources}. */
export const TRANSFERRED_PROJECT_RESOURCES = [
	'SharedWorkflow',
	'SharedCredentials',
	'Folder',
	'DataTable',
] as const;

/**
 * Entity class names intentionally NOT transferred, with the reason why.
 * An entry here is a conscious product/engineering decision, reviewed in the
 * PR that adds it — not a fallback for "forgot to handle it".
 */
/* eslint-disable @typescript-eslint/naming-convention -- keys are entity class names */
export const NOT_TRANSFERRED_PROJECT_RESOURCES: Record<string, string> = {
	ProjectRelation: 'Project membership rows; they describe the deleted project itself.',
	ProjectSecretsProviderAccess:
		'Per-project secrets-provider config; scoped to the deleted project.',
	RoleMappingRule: 'SSO role-mapping config attached to the project, not user data.',
	Variables:
		'Project-scoped variables are dropped via FK cascade; personal projects do not expose them.',
	Agent:
		'Dropped via FK cascade today. Revisit: agents created by the deleted user are lost on transfer.',
	AgentExecutionThread: 'Dropped via FK cascade together with its Agent.',
	InstanceAiThread: 'AI assistant conversation history; personal to the deleted user.',
};
