"use client";

import { useApi } from "@/lib/fetch-client";

export function useConnectors() {
	return useApi().useQuery(
		"get",
		"/connectors",
		{},
		{ refetchOnWindowFocus: true },
	);
}
