"use client";

import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

/**
 * Shared DevPass status query. React Query dedupes by key, so calling this from
 * the shell and each dashboard page results in a single in-flight request while
 * every consumer stays in sync.
 */
export function useDevPlanStatus() {
	const api = useApi();
	const { user } = useUser();

	return api.useQuery(
		"get",
		"/dev-plans/status",
		{},
		{
			enabled: !!user,
			refetchInterval: 5000,
		},
	);
}
