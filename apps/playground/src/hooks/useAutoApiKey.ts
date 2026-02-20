"use client";

import { useApiKey } from "@/hooks/useApiKey";
import { useDefaultProject } from "@/hooks/useDefaultProject";
import { useApi } from "@/lib/fetch-client";

/**
 * Hook that automatically fetches and sets API key for new users
 * who don't have one stored locally but have an auto-generated one on the server
 */
export function useAutoApiKey() {
	const api = useApi();
	const { data: defaultProject } = useDefaultProject();
	const { userApiKey, isLoaded } = useApiKey();

	// Fetch API keys from server for the default project
	const { data: apiKeysData, isLoading } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: { projectId: defaultProject?.id ?? "" },
			},
		},
		{
			enabled: !!defaultProject?.id && isLoaded && !userApiKey,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);

	return {
		hasAnyKey:
			!isLoading &&
			apiKeysData?.apiKeys?.some((key) => key.status === "active"),
		isLoading,
	};
}
