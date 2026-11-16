import { getInitialApiKeyUsageQuery } from "@/components/api-keys/api-key-usage-period-server";
import { ApiKeysClient } from "@/components/api-keys/api-keys-client";
import { fetchServerData } from "@/lib/server-api";

import type { ApiKeyUsageSearchParams } from "@/components/api-keys/api-key-usage-period-server";
import type { ApiKeysResponse } from "@/components/api-keys/api-keys-list";

export default async function OrganizationApiKeysPage({
	params,
	searchParams,
}: {
	params: Promise<{ orgId: string }>;
	searchParams: Promise<ApiKeyUsageSearchParams>;
}) {
	const [{ orgId }, query] = await Promise.all([params, searchParams]);
	const usageQuery = await getInitialApiKeyUsageQuery(query);

	const initialData = await fetchServerData<ApiKeysResponse>(
		"GET",
		"/keys/api",
		{
			params: {
				query: { organizationId: orgId, ...usageQuery },
			},
		},
	);

	return (
		<ApiKeysClient
			scope="organization"
			initialData={initialData ?? undefined}
			initialUsageQuery={usageQuery}
		/>
	);
}
