import { useQueryClient } from "@tanstack/react-query";

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

export function useUpdateOrganization() {
	const api = useApi();
	const queryClient = useQueryClient();
	return api.useMutation("patch", "/orgs/{id}", {
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/orgs").queryKey,
			});
		},
	});
}
