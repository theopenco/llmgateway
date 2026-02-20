import { ProviderKeysClient } from "@/components/provider-keys/provider-keys-client";
import { fetchServerData } from "@/lib/server-api";

import type { ProviderKeyOptions } from "@llmgateway/db";

interface ProviderKeysData {
	providerKeys: {
		id: string;
		createdAt: string;
		updatedAt: string;
		provider: string;
		name: string | null;
		baseUrl: string | null;
		options: ProviderKeyOptions | null;
		status: "active" | "inactive" | "deleted" | null;
		organizationId: string;
		maskedToken: string;
	}[];
}

export default async function ProviderKeysPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;

	// Server-side data fetching for provider keys
	const initialProviderKeysData = await fetchServerData<ProviderKeysData>(
		"GET",
		"/keys/provider",
		{
			params: {
				query: {
					organizationId: orgId,
				},
			},
		},
	);

	return (
		<ProviderKeysClient
			initialProviderKeysData={initialProviderKeysData ?? undefined}
		/>
	);
}
