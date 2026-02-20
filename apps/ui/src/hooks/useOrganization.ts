import { useApi } from "@/lib/fetch-client";

import type { Organization } from "@/lib/types";

export interface OrganizationsResponse {
	organizations: Organization[];
}

export function useDefaultOrganization() {
	const api = useApi();
	const { data, error } = api.useSuspenseQuery("get", "/orgs");

	if (!data?.organizations || data.organizations.length === 0) {
		return {
			data: null,
			error: error ?? new Error("No organizations found"),
		};
	}

	return { data: data.organizations[0], error };
}
