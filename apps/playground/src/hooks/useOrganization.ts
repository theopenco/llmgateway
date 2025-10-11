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
	} = api.useQuery("get", "/orgs");

	// Get the first (default) organization
	const organization: Organization | null =
		orgsData?.organizations?.[0] || null;

	return {
		organization,
		isLoading,
		isError,
		error,
	};
}
