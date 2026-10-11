"use client";

import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "@/lib/fetch-client";

export function useInvalidateCompanies() {
	const api = useApi();
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/airside/companies", {}).queryKey,
		});
}
