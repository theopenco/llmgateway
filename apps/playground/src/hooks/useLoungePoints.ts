"use client";

import { useUser } from "@/hooks/useUser";
import { useApi } from "@/lib/fetch-client";

export function useLoungePoints() {
	const { user } = useUser();
	const api = useApi();

	return api.useQuery(
		"get",
		"/lounge/points/me",
		{},
		{
			enabled: !!user,
			retry: 0,
			staleTime: 60 * 1000,
			refetchOnWindowFocus: false,
		},
	);
}
