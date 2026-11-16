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
	currentRates: { inputPrice?: string; outputPrice?: string } = {},
) {
	state.currentPricing =
		current === undefined
			? null
			: {
					inputPrice: currentRates.inputPrice ?? "0.000001",
					outputPrice: currentRates.outputPrice ?? "0.000002",
					cachedInputPrice: current,
				};
	state.cachedInputPrice = filed;
	return renderToStaticMarkup(createElement(AirsideFilingsClient));
}

describe("filing price comparisons", () => {
	it.each([
		["unchanged", "0.0000001", "0.0000001", "cached: $0.1/M", 0],
		["equivalent", "0.00000010", "1e-7", "cached: $0.1/M", 0],
		["changed", "0.0000001", "0.0000002", "cached: $0.1/M → $0.2/M", 1],
		["added", null, "0.0000001", "cached: none → $0.1/M", 1],
		["removed", "0.0000001", null, "cached: $0.1/M → none", 1],
		["zero unchanged", "0", "0", "cached: $0/M", 0],
		["zero added", null, "0", "cached: none → $0/M", 1],
		["zero removed", "0", null, "cached: $0/M → none", 1],
	])(
		"renders cached pricing when %s",
		(_label, current, filed, expected, arrows) => {
			const markup = renderPrices(current, filed);
			expect(markup).toContain("in: $1/M</div>");
			expect(markup).toContain("out: $2/M</div>");
			expect(markup).toContain(expected + "</div>");
			expect(markup.match(/(?:in|out|cached): [^<]* → /g) ?? []).toHaveLength(
				arrows,
			);
		},
	);

	it.each([
		["input", { inputPrice: "0.000003" }, "in: $3/M → $1/M", "out: $2/M"],
		["output", { outputPrice: "0.000004" }, "out: $4/M → $2/M", "in: $1/M"],
	])(
		"shows an arrow only for changed %s pricing",
		(_label, current, changed, unchanged) => {
			const markup = renderPrices("0.0000001", "0.0000001", current);
			expect(markup).toContain(changed + "</div>");
			expect(markup).toContain(unchanged + "</div>");
			expect(markup).toContain("cached: $0.1/M</div>");
			expect(markup.match(/(?:in|out|cached): [^<]* → /g) ?? []).toHaveLength(
				1,
			);
		},
	);

	it("does not mark equivalent input/output decimal representations as changes", () => {
		const markup = renderPrices(null, null, {
			inputPrice: "1e-6",
			outputPrice: "0.00000200",
		});
		expect(markup).toContain("in: $1/M</div>");
		expect(markup).toContain("out: $2/M</div>");
		expect(markup).not.toMatch(/(?:in|out|cached): [^<]* → /);
	});

	it("marks each rate when all rates change", () => {
		const markup = renderPrices("0.0000003", "0.0000001", {
			inputPrice: "0.000003",
			outputPrice: "0.000004",
		});
		expect(markup).toContain("in: $3/M → $1/M</div>");
		expect(markup).toContain("out: $4/M → $2/M</div>");
		expect(markup).toContain("cached: $0.3/M → $0.1/M</div>");
	});

	it("shows only the filed prices for an initial filing", () => {
		const markup = renderPrices(undefined, "0.0000001");
		expect(markup).toContain("in: $1/M</div>");
		expect(markup).toContain("out: $2/M</div>");
		expect(markup).toContain("cached: $0.1/M</div>");
		expect(markup).not.toMatch(/(?:in|out|cached): [^<]* → /);
	});

	it("omits cached pricing when neither price is set", () => {
		expect(renderPrices(null, null)).not.toContain("cached:");
	});
});
