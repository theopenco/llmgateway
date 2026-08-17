import { ProviderListingClient } from "@/components/provider-listing/provider-listing-client";
import { fetchServerData } from "@/lib/server-api";

import type { paths } from "@/lib/api/v1";

type ListingsData =
	paths["/provider-listings"]["get"]["responses"][200]["content"]["application/json"];

export default async function ProviderListingPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;

	const initialData = await fetchServerData<ListingsData>(
		"GET",
		"/provider-listings",
		{
			params: { query: { organizationId: orgId } },
		},
	);

	return (
		<ProviderListingClient orgId={orgId} initialData={initialData ?? null} />
	);
}
