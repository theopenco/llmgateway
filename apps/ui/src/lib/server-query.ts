import {
	QueryClient,
	defaultShouldDehydrateQuery,
} from "@tanstack/react-query";
import createClient from "openapi-react-query";

import { createServerApiClient } from "./server-api";

// Request-scoped client for prefetching in server components. It dehydrates
// queries that are still in flight, so a page can render at once and stream
// the data to the browser's cache through a HydrationBoundary.
export async function createServerQuery() {
	const queryClient = new QueryClient({
		defaultOptions: {
			dehydrate: {
				shouldDehydrateQuery: (query) =>
					defaultShouldDehydrateQuery(query) ||
					query.state.status === "pending",
			},
		},
	});
	const api = createClient(await createServerApiClient());
	return { queryClient, api };
}
