import { useQuery } from "@tanstack/react-query";

import { useAppConfig } from "@/lib/config";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";

export function useModels() {
	const config = useAppConfig();

	return useQuery<ApiModel[]>({
		queryKey: ["internal-models"],
		queryFn: async () => {
			const response = await fetch(`${config.apiUrl}/internal/models`);
			if (!response.ok) {
				throw new Error("Failed to fetch models");
			}
			const data = await response.json();
			return data.models || [];
		},
		staleTime: 60 * 1000, // 1 minute
	});
}

export function useProviders() {
	const config = useAppConfig();

	return useQuery<ApiProvider[]>({
		queryKey: ["internal-providers"],
		queryFn: async () => {
			const response = await fetch(`${config.apiUrl}/internal/providers`);
			if (!response.ok) {
				throw new Error("Failed to fetch providers");
			}
			const data = await response.json();
			return data.providers || [];
		},
		staleTime: 60 * 1000, // 1 minute
	});
}

export function useModelsAndProviders() {
	const modelsQuery = useModels();
	const providersQuery = useProviders();

	return {
		models: modelsQuery.data ?? [],
		providers: providersQuery.data ?? [],
		isLoading: modelsQuery.isLoading || providersQuery.isLoading,
		error: modelsQuery.error || providersQuery.error,
	};
}
