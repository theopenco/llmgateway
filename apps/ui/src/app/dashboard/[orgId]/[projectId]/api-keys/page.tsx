import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { fetchServerData } from "@/lib/server-api";

import type { ApiKey } from "@/lib/types";

export default async function ApiKeysPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { projectId } = await params;

	// Server-side data fetching for provider keys
	const initialData = await fetchServerData<{ apiKeys: ApiKey[] }>(
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

	return <ApiKeysClient initialData={initialData?.apiKeys || []} />;
}
