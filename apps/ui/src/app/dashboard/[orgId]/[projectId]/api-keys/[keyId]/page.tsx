import { ApiKeyStatsClient } from "@/components/api-keys/api-key-stats-client";

export default async function ApiKeyStatsPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string; keyId: string }>;
}) {
	const { projectId, keyId } = await params;

	return <ApiKeyStatsClient projectId={projectId} keyId={keyId} />;
}
