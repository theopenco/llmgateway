import { beforeEach, describe, expect, it, vi } from "vitest";

import { responses } from "./responses.js";

const mocks = vi.hoisted(() => ({
	appRequest: vi.fn(),
	findOrganizationById: vi.fn(),
	storeResponse: vi.fn(),
}));

vi.mock("@/app.js", () => ({
	app: { request: mocks.appRequest },
}));

vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberProjectAccess: vi.fn(),
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
	findOrganizationById: mocks.findOrganizationById,
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
	storeResponse: mocks.storeResponse,
}));

describe("responses streaming lifecycle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findOrganizationById.mockResolvedValue({
			id: "org_test",
			plan: "enterprise",
			status: "active",
		});
	});

	it.each([
		{ path: "/", noFallback: "true" },
		{ path: "/", noFallback: "false" },
		{ path: "/", noFallback: undefined },
		{ path: "/compact", noFallback: "true" },
		{ path: "/compact", noFallback: "false" },
		{ path: "/compact", noFallback: undefined },
	])(
		"preserves x-no-fallback=$noFallback on $path",
		async ({ path, noFallback }) => {
			mocks.appRequest.mockResolvedValue(
				Response.json(
					{ error: { message: "Upstream unavailable" } },
					{ status: 503 },
				),
			);
			const headers = new Headers({
				authorization: "Bearer test-token",
				"content-type": "application/json",
			});
			if (noFallback !== undefined) {
				headers.set("X-No-Fallback", noFallback);
			}

			const response = await responses.request(path, {
				method: "POST",
				headers,
				body: JSON.stringify({
					model: "aws-mantle/gpt-6-astra:us-west-2",
					input: "hello",
					store: false,
				}),
			});

			expect(response.status).toBe(503);
			expect(mocks.appRequest).toHaveBeenCalledOnce();
			const forwardedHeaders = new Headers(
				mocks.appRequest.mock.calls[0]![1].headers,
			);
			expect(forwardedHeaders.get("x-no-fallback")).toBe(noFallback ?? null);
		},
	);

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

	it("rejects Responses API storage while ZDR is active", async () => {
		mocks.findOrganizationById.mockResolvedValue({
			id: "org_test",
			plan: "enterprise",
			status: "active",
			providerCompliancePolicy: {
				enabled: true,
				zeroDataRetention: true,
			},
		});
		const response = await responses.request("/", {
			method: "POST",
			headers: {
				authorization: "Bearer test-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				input: "hello",
				store: true,
			}),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: {
				code: "zdr_storage_conflict",
				message: expect.stringContaining("Set store to false"),
			},
		});
		expect(mocks.appRequest).not.toHaveBeenCalled();
		expect(mocks.storeResponse).not.toHaveBeenCalled();
	});

	it("does not store compacted Responses state while ZDR is active", async () => {
		mocks.findOrganizationById.mockResolvedValue({
			id: "org_test",
			plan: "enterprise",
			status: "active",
			providerCompliancePolicy: {
				enabled: true,
				zeroDataRetention: true,
			},
		});
		mocks.appRequest.mockResolvedValue(
			Response.json({
				id: "chatcmpl_test",
				object: "chat.completion",
				created: 1,
				model: "openai/gpt-4o-mini",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Summary" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 1,
					completion_tokens: 1,
					total_tokens: 2,
				},
			}),
		);

		const response = await responses.request("/compact", {
			method: "POST",
			headers: {
				authorization: "Bearer test-token",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: "gpt-4o-mini",
				input: "Compact this conversation",
			}),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			object: "response.compaction",
		});
		expect(mocks.storeResponse).not.toHaveBeenCalled();
	});
});
