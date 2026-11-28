import { useQueryClient } from "@tanstack/react-query";

import { useApi } from "./fetch-client";

export function useInvalidateFleet(providerCompanyId: string) {
	const api = useApi();
	const queryClient = useQueryClient();

	return {
		models: () =>
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/models", {
					params: { query: { providerCompanyId } },
				}).queryKey,
			}),
		filings: () =>
			queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/airside/filings", {
					params: { query: { providerCompanyId } },
				}).queryKey,
			}),
	};
}
