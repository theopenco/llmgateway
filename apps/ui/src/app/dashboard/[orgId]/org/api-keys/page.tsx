import { parseApiKeyUsagePeriod } from "@/components/api-keys/api-key-usage-period";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { fetchServerData } from "@/lib/server-api";

import type { ApiKey } from "@/lib/types";

export default async function OrganizationApiKeysPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams: Promise<{ period?: string | string[] }>;
}) {
	const [{ orgId }, query] = await Promise.all([params, searchParams]);
	const period = parseApiKeyUsagePeriod(query.period);

	const initialData = await fetchServerData<{ apiKeys: ApiKey[] }>(
		"GET",
		"/keys/api",
		{
			params: {
				query: { organizationId: orgId, period },
			},
		},
	);

	return (
		<ApiKeysClient
			scope="organization"
			initialData={initialData?.apiKeys ?? []}
			initialPeriod={period}
		/>
	);
}
