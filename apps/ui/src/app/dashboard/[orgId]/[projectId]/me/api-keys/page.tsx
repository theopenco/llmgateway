import { parseApiKeyUsagePeriod } from "@/components/api-keys/api-key-usage-period";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { fetchServerData } from "@/lib/server-api";

import type { ApiKeysResponse } from "@/components/api-keys/api-keys-list";

export default async function DeveloperApiKeysPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
	searchParams: Promise<{ period?: string | string[] }>;
}) {
	const [{ projectId }, query] = await Promise.all([params, searchParams]);
	const period = parseApiKeyUsagePeriod(query.period);

	const initialData = await fetchServerData<ApiKeysResponse>(
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
			initialData={initialData ?? undefined}
			initialPeriod={period}
		/>
	);
}
