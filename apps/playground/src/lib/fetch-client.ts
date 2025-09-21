import createFetchClient from "openapi-fetch";
import createClient from "openapi-react-query";
import { useMemo } from "react";

import { useAppConfig } from "./config";

import type { paths } from "./api/v1";

// React hook to get the fetch client
export function useFetchClient() {
	const config = useAppConfig();

	return useMemo(() => {
		return createFetchClient<paths>({
			baseUrl: config.apiUrl,
			credentials: "include",
		});
	}, [config.apiUrl]);
}

// React hook to get the API client
export function useApi() {
	const fetchClient = useFetchClient();

	return useMemo(() => {
		return createClient(fetchClient);
	}, [fetchClient]);
}
