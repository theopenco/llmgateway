import type { QueryClient } from "@tanstack/react-query";

const PLAN_QUERY_PATHS = new Set([
	"/orgs",
	"/subscriptions/status",
	"/team/{organizationId}/members",
	"/keys/api",
	"/sso/providers",
	"/sso/scim",
]);

export async function invalidateProPlanQueries(
	queryClient: QueryClient,
): Promise<void> {
	await queryClient.invalidateQueries({
		predicate: ({ queryKey }) =>
			queryKey[0] === "get" &&
			typeof queryKey[1] === "string" &&
			PLAN_QUERY_PATHS.has(queryKey[1]),
	});
}
