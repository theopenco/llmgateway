"use client";

import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

import type { paths } from "@/lib/api/v1";

export type DevPlanStatus =
	paths["/dev-plans/status"]["get"]["responses"]["200"]["content"]["application/json"];

/**
 * Shared DevPass status query. React Query dedupes by key, so calling this from
 * the shell and each dashboard page results in a single in-flight request while
 * every consumer stays in sync.
 *
 * Pass `initialData` (fetched server-side) to render the correct shell on the
 * first paint and avoid flashing the plan chooser before the status loads.
 */
export function useDevPlanStatus(initialData?: DevPlanStatus | null) {
	const api = useApi();
	const { user } = useUser();

	return api.useQuery(
		"get",
		"/dev-plans/status",
		{},
		{
			enabled: !!user,
			refetchInterval: 5000,
			initialData: initialData ?? undefined,
		},
	);
}
