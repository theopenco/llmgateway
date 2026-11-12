import { getInitialApiKeyUsageQuery } from "@/components/api-keys/api-key-usage-period-server";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { fetchServerData } from "@/lib/server-api";

import type { ApiKeyUsageSearchParams } from "@/components/api-keys/api-key-usage-period-server";
import type { ApiKeysResponse } from "@/components/api-keys/api-keys-list";

export default async function ApiKeysPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams: Promise<ApiKeyUsageSearchParams>;
}) {
	const [{ projectId }, query] = await Promise.all([params, searchParams]);
	const usageQuery = await getInitialApiKeyUsageQuery(query);

	const initialData = await fetchServerData<ApiKeysResponse>(
		"GET",
		"/keys/api",
		{
			params: {
				query: { projectId, ...usageQuery },
			},
		},
	);

	return (
		<ApiKeysClient
			scope="project"
			initialData={initialData ?? undefined}
			initialUsageQuery={usageQuery}
		/>
	);
}
