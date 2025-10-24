import { ProviderKeysClient } from "@/components/provider-keys/provider-keys-client";
import { fetchServerData } from "@/lib/server-api";

// Force dynamic rendering since this page uses server-side data fetching with cookies
export const dynamic = "force-dynamic";

interface ProviderKeyOptions {
	aws_bedrock_region_prefix?: "us." | "global." | "eu.";
	azure_resource?: string;
	azure_api_version?: string;
	azure_deployment_type?: "openai" | "ai-foundry";
	azure_validation_model?: string;
}

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
			initialProviderKeysData={initialProviderKeysData || undefined}
		/>
	);
}
