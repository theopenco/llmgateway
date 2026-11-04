import { QueryClient } from "@tanstack/react-query";
import { expect, it } from "vitest";

import { invalidateProPlanQueries } from "./pro-plan-cache";

it("refreshes purchased limits and add-ons without invalidating unrelated data", async () => {
	const client = new QueryClient();
	const paths = [
		"/orgs",
		"/subscriptions/status",
		"/team/{organizationId}/members",
		"/keys/api",
		"/sso/providers",
		"/sso/scim",
	];
	for (const path of [...paths, "/models"]) {
		client.setQueryData(["get", path, { organizationId: "test-org" }], {});
	}
	await invalidateProPlanQueries(client);
	for (const path of paths) {
		expect(
			client.getQueryState(["get", path, { organizationId: "test-org" }])
				?.isInvalidated,
		).toBe(true);
	}
	expect(
		client.getQueryState(["get", "/models", { organizationId: "test-org" }])
			?.isInvalidated,
	).toBe(false);
	client.clear();
});
