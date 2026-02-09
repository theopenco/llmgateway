import { IamRulesClient } from "@/components/api-keys/iam-rules-client";
import { fetchServerData } from "@/lib/server-api";

import type { ApiKey } from "@/lib/types";

export default async function IamRulesPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string; keyId: string }>;
}) {
	const { projectId, keyId } = await params;

	// Fetch all API keys for the project and find the specific one
	const apiKeysData = await fetchServerData<{ apiKeys: ApiKey[] }>(
		"GET",
		"/keys/api",
		{
			params: {
				query: {
					projectId: projectId,
				},
			},
		},
	);

	const apiKey = apiKeysData?.apiKeys?.find((key) => key.id === keyId);

	if (!apiKey) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<p className="text-gray-400">API key not found.</p>
			</div>
		);
	}

	return <IamRulesClient apiKey={apiKey} />;
}
