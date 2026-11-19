import { afterEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import { resetFailOnceCounter } from "@/test-utils/mock-openai-server.js";
import { waitForLogs } from "@/test-utils/test-helpers.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

const ID_PATTERN = /^lgr_[0-9A-Za-z]{20}$/;

interface UpstreamCall {
	url: string;
	headers: Headers;
	responseRequestId: string;
}

/**
 * Records every request to the mock upstream and stamps each response with a
 * distinct provider `x-request-id`.
 */
function captureUpstream(mockServerUrl: string): UpstreamCall[] {
	const original = globalThis.fetch;
	const calls: UpstreamCall[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const res = await original(input, init);
		if (!url.startsWith(mockServerUrl)) {
			return res;
		}
		const responseRequestId = `req_mock_${calls.length + 1}`;
		calls.push({ url, headers: new Headers(init?.headers), responseRequestId });
		const headers = new Headers(res.headers);
		headers.set("x-request-id", responseRequestId);
		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers,
		});
	});
	return calls;
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("upstream client request id", () => {
	const harness = createGatewayApiTestHarness();

	async function insertApiKey(id: string, token: string) {
		await db.insert(tables.apiKey).values({
			id,
			...hashApiKeyForStorage(token),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	}

	async function insertProviderKey(id: string, provider: string) {
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage(`${id}-token`, id, "org-id"),
			provider,
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	test("sends a fresh id to OpenAI on every BYOK retry and logs it", async () => {
		await harness.setProjectMode("api-keys");
		await insertApiKey("token-id-crid", "real-token-crid");
		await insertProviderKey("provider-key-crid-a", "openai");
		await insertProviderKey("provider-key-crid-b", "openai");
		resetFailOnceCounter();
		const calls = captureUpstream(harness.mockServerUrl);

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-crid",
				// Client values never reach the provider header.
				"X-Client-Request-Id": "client-chosen",
			},
			body: JSON.stringify({
				model: "openai/gpt-4o-mini",
				messages: [{ role: "user", content: "TRIGGER_FAIL_ONCE crid" }],
			}),
		});
		expect(res.status, await res.text()).toBe(200);

		const sent = calls.map((call) => call.headers.get("x-client-request-id"));
		expect(sent).toHaveLength(2);
		for (const id of sent) {
			expect(id).toMatch(ID_PATTERN);
		}
		expect(sent[0]).not.toBe(sent[1]);

		const logs = await waitForLogs(2);
		const failed = logs.find((log) => log.hasError);
		const succeeded = logs.find((log) => !log.hasError);
		expect(failed?.retried).toBe(true);
		expect(failed?.upstreamClientRequestId).toBe(sent[0]);
		expect(failed?.upstreamRequestId).toBe(calls[0].responseRequestId);
		expect(succeeded?.upstreamClientRequestId).toBe(sent[1]);
		expect(succeeded?.upstreamRequestId).toBe(calls[1].responseRequestId);
		expect(succeeded?.apiKeyId).toBe("token-id-crid");
	});

	test("sends x-ms-client-request-id to Azure and logs it", async () => {
		await insertApiKey("token-id-crid-azure", "real-token-crid-azure");
		await insertProviderKey("provider-key-crid-azure", "azure");
		const calls = captureUpstream(harness.mockServerUrl);

		const res = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-crid-azure",
			},
			body: JSON.stringify({
				model: "azure/text-embedding-3-small",
				input: "crid azure",
			}),
		});
		expect(res.status, await res.text()).toBe(200);

		expect(calls).toHaveLength(1);
		const sent = calls[0].headers.get("x-ms-client-request-id");
		expect(sent).toMatch(ID_PATTERN);
		expect(calls[0].headers.has("x-client-request-id")).toBe(false);

		const [log] = await waitForLogs(1);
		expect(log.upstreamClientRequestId).toBe(sent);
		expect(log.upstreamRequestId).toBe(calls[0].responseRequestId);
	});

	test("sends no client request id to providers without one", async () => {
		await insertApiKey("token-id-crid-anthropic", "real-token-crid-anthropic");
		await insertProviderKey("provider-key-crid-anthropic", "anthropic");
		const calls = captureUpstream(harness.mockServerUrl);

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token-crid-anthropic",
				"x-no-fallback": "true",
			},
			body: JSON.stringify({
				model: "anthropic/claude-sonnet-4-6",
				messages: [{ role: "user", content: "crid anthropic" }],
			}),
		});
		expect(res.status, await res.text()).toBe(200);

		expect(calls).toHaveLength(1);
		expect(calls[0].headers.has("x-client-request-id")).toBe(false);
		expect(calls[0].headers.has("x-ms-client-request-id")).toBe(false);

		const [log] = await waitForLogs(1);
		expect(log.upstreamClientRequestId).toBeNull();
		expect(log.upstreamRequestId).toBeNull();
	});
});
