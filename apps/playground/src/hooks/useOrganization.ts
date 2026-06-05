"use client";

import { useApi } from "@/lib/fetch-client";

import type { Organization } from "@/lib/types";

export function useOrganization() {
	const api = useApi();

	const {
		data: orgsData,
		isLoading,
		isError,
		error,
	} = api.useQuery("get", "/orgs", {
		params: { query: { includeChat: "true" } },
	});

	// The playground is the consumer chat product — pay-as-you-go credits and the
	// chat plan live on the dedicated Chat org, so prefer it over dashboard orgs.
	const organizations = orgsData?.organizations ?? [];
	const organization: Organization | null =
		organizations.find((o) => o.isChat) ?? organizations[0] ?? null;

	return {
		organization,
		isLoading,
		isError,
		error,
	};
}
