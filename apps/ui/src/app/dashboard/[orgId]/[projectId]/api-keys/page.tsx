import { parseApiKeyUsagePeriod } from "@/components/api-keys/api-key-usage-period";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { fetchServerData } from "@/lib/server-api";

import type { ApiKey } from "@/lib/types";

export default async function ApiKeysPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams: Promise<{ period?: string | string[] }>;
}) {
	const [{ projectId }, query] = await Promise.all([params, searchParams]);
	const period = parseApiKeyUsagePeriod(query.period);

	const initialData = await fetchServerData<{ apiKeys: ApiKey[] }>(
		"GET",
		"/keys/api",
		{
			params: {
				query: { projectId, period },
			},
		},
	);

	return (
		<ApiKeysClient
			scope="project"
			initialData={initialData?.apiKeys ?? []}
			initialPeriod={period}
		/>
	);
}
