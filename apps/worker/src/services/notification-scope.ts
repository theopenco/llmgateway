import type { ApiKeyScope } from "@llmgateway/actions";

export function canReadEvent(
	scope: ApiKeyScope,
	event: { projectId?: string | null; apiKeyId?: string | null },
): boolean {
	if (!event.projectId) {
		return false;
	}
	return (
		scope.privilegedProjectIds.includes(event.projectId) ||
		(scope.restrictedProjectIds.includes(event.projectId) &&
			!!event.apiKeyId &&
			scope.ownApiKeyIds.includes(event.apiKeyId))
	);
}
