import { beforeEach, expect, test, vi } from "vitest";

import { getDynamicRouteProviderOptions } from "./dynamic-route-providers.js";

const mocks = vi.hoisted(() => ({ listings: vi.fn(), claims: vi.fn() }));
vi.mock("@llmgateway/db", () => ({
	db: {
		query: {
			modelProviderMapping: { findMany: mocks.listings },
			providerClaim: { findMany: mocks.claims },
		},
	},
}));

beforeEach(() => {
	mocks.claims.mockResolvedValue([]);
});

test("stale active historical listings never advertise old carriers or migrate them to the snapshot", async () => {
	mocks.listings.mockResolvedValue([
		{
			modelId: "deepseek-v4-flash",
			providerId: "canopywave",
			status: "active",
			deactivatedAt: null,
			provider: { name: "Test Carrier" },
		},
	]);
	const options = await getDynamicRouteProviderOptions();
	expect(
		options.find((model) => model.modelId === "deepseek-v4-flash"),
	).toBeUndefined();
	expect(
		options
			.find((model) => model.modelId === "deepseek-v4-flash-0731")
			?.providers.some((provider) => provider.id === "canopywave"),
	).toBe(false);
});

test("approved snapshot listings retain their own carrier options", async () => {
	mocks.listings.mockResolvedValue([
		{
			modelId: "deepseek-v4-flash-0731",
			providerId: "canopywave",
			status: "active",
			deactivatedAt: null,
			provider: { name: "Test Carrier" },
		},
	]);
	const options = await getDynamicRouteProviderOptions();
	expect(
		options.find((model) => model.modelId === "deepseek-v4-flash-0731")
			?.providers,
	).toContainEqual(expect.objectContaining({ id: "canopywave" }));
});
