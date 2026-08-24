import { describe, expect, it, vi } from "vitest";

import { responses } from "./responses.js";

const mocks = vi.hoisted(() => ({
	appRequest: vi.fn(),
}));

vi.mock("@/app.js", () => ({
	app: { request: mocks.appRequest },
}));

vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberWithinBudget: vi.fn(),
}));

vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: vi.fn().mockResolvedValue({
		id: "key_test",
		projectId: "project_test",
		createdBy: "user_test",
		status: "active",
	}),
	findProjectById: vi.fn().mockResolvedValue({
		id: "project_test",
		organizationId: "org_test",
	}),
	findOrganizationById: vi.fn().mockResolvedValue({
		id: "org_test",
		status: "active",
	}),
}));

vi.mock("@/lib/organization-access.js", () => ({
	getOrganizationBlockReason: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/responses-context.js", () => ({
	deleteResponsesContext: vi.fn(),
	setResponsesContext: vi.fn(),
}));

vi.mock("./tools/response-state.js", () => ({
	getStoredResponse: vi.fn(),
	resolveItemReferences: vi.fn(async (items) => items),
	storeResponse: vi.fn(),
}));

describe("responses streaming lifecycle", () => {
	it("emits response.created before an early response.failed", async () => {
		mocks.appRequest.mockResolvedValue(
			new Response(
				new ReadableStream({
					pull() {
						throw new Error("stream failed before first chunk");
					},
				}),
				{ status: 200 },
			),
		);

		const response = await responses.request("/", {
			method: "POST",
			headers: {
				authorization: "Bearer test-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				input: "hello",
				stream: true,
				store: false,
			}),
		});

		expect(response.status).toBe(200);
		const eventTypes = (await response.text())
			.split("\n")
			.filter((line) => line.startsWith("event: "))
			.map((line) => line.slice(7));
		expect(eventTypes).toEqual(["response.created", "response.failed"]);
	});
});
