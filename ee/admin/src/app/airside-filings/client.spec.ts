import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, afterAll, beforeAll } from "vitest";

import { AirsideFilingsClient } from "./client";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const state = vi.hoisted(() => ({
	currentPricing: null as {
		inputPrice: string;
		outputPrice: string;
		cachedInputPrice: string | null;
	} | null,
	cachedInputPrice: null as string | null,
}));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/lib/admin-role-context", () => ({ useAdminRole: () => "admin" }));
vi.mock("@/components/airside-listings-table", () => ({
	AirsideListingsTable: () => null,
}));
vi.mock("@/components/model-verification-dialog", () => ({
	ModelVerificationDialog: () => null,
	VerificationStatusBadge: () => null,
}));
vi.mock("@/lib/fetch-client", () => ({
	useApi: () => ({
		useMutation: () => ({ isPending: false }),
		useQuery: (_method: string, path: string) => ({
			data:
				path === "/admin/airside/filings"
					? {
							filings: [
								{
									id: "test-filing",
									createdAt: "2026-01-01T00:00:00Z",
									company: { name: "Test Company" },
									model: {
										id: "test-model",
										providerId: "test-provider",
										modelName: "test-model",
										externalId: "test-model",
										apiFormat: "openai-chat-completions",
									},
									kind: state.currentPricing ? "update" : "initial",
									status: "pending",
									inputPrice: "0.000001",
									outputPrice: "0.000002",
									cachedInputPrice: state.cachedInputPrice,
									currentPricing: state.currentPricing,
									cachedPriceWarnings: [],
								},
							],
						}
					: undefined,
		}),
	}),
}));

function renderPrices(
	current: string | null | undefined,
	filed: string | null,
) {
	state.currentPricing =
		current === undefined
			? null
			: {
					inputPrice: "0.000001",
					outputPrice: "0.000002",
					cachedInputPrice: current,
				};
	state.cachedInputPrice = filed;
	const markup = renderToStaticMarkup(createElement(AirsideFilingsClient));
	return markup.replace(/<[^>]*>/g, "");
}

describe("filing cached-input prices", () => {
	it.each([
		["unchanged", "0.0000001", "0.0000001", "cached: $0.1/M → $0.1/M"],
		["changed", "0.0000001", "0.0000002", "cached: $0.1/M → $0.2/M"],
		["added", null, "0.0000001", "cached: none → $0.1/M"],
		["removed", "0.0000001", null, "cached: $0.1/M → none"],
		["zero", "0", "0", "cached: $0/M → $0/M"],
	])("shows current → filed when %s", (_label, current, filed, expected) => {
		const text = renderPrices(current, filed);
		expect(text).toContain("in: $1/M → $1/M");
		expect(text).toContain("out: $2/M → $2/M");
		expect(text).toContain(expected);
	});

	it("shows only the filed price for an initial filing", () => {
		const text = renderPrices(undefined, "0.0000001");
		expect(text).toContain("cached: $0.1/M");
		expect(text).not.toContain("→ $0.1/M");
	});

	it("omits cached pricing when neither price is set", () => {
		expect(renderPrices(null, null)).not.toContain("cached:");
	});
});
