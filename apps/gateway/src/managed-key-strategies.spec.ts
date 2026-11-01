import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { resetKeyHealth } from "./lib/api-key-health.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

const IDS = ["pool-a", "pool-b", "ordered-fallback"];

function gatewayStrategyTests() {
	const harness = createGatewayApiTestHarness();
	let previousInsecure: string | undefined;
	let previousProviderEnv = new Map<string, string | undefined>();
	let sequence = 0;

	beforeEach(async () => {
		resetKeyHealth();
		previousInsecure = process.env.ALLOW_INSECURE_PROVIDER_URLS;
		previousProviderEnv = new Map(
			Object.entries(process.env).filter(([name]) => name.startsWith("LLM_")),
		);
		for (const name of previousProviderEnv.keys()) {
			process.env[name] = "";
		}
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "strategy-api-key",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Strategy test key",
			createdBy: "user-id",
		});
		for (const [sortOrder, id] of IDS.entries()) {
			await db.insert(tables.providerKey).values({
				id,
				provider: "openai",
				managed: true,
				organizationId: null,
				sortOrder,
				selectionStrategy: sortOrder < 2 ? "round_robin" : "ordered",
				config: { baseUrl: harness.mockServerUrl },
				...encryptProviderKeyForStorage(`token-${id}`, id, null),
			});
		}
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (previousInsecure === undefined) {
			delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		} else {
			process.env.ALLOW_INSECURE_PROVIDER_URLS = previousInsecure;
		}
		for (const [name, value] of previousProviderEnv) {
			if (value === undefined) {
				Reflect.deleteProperty(process.env, name);
			} else {
				process.env[name] = value;
			}
		}
	});

	function observeUpstream(failedIds: ReadonlySet<string> = new Set()) {
		const attempts: string[] = [];
		const originalFetch = globalThis.fetch;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url = input instanceof Request ? input.url : String(input);
			if (!url.startsWith(harness.mockServerUrl)) {
				throw new Error("Unexpected non-local upstream in strategy test");
			}
			const authorization = new Headers(init?.headers).get("authorization");
			const id = IDS.find(
				(candidate) => authorization === `Bearer token-${candidate}`,
			);
			if (id) {
				attempts.push(id);
				if (failedIds.has(id)) {
					return new Response(
						JSON.stringify({ error: { message: "Invalid API key" } }),
						{
							status: 401,
							headers: { "Content-Type": "application/json" },
						},
					);
				}
			}
			return await originalFetch(input, init);
		});
		return attempts;
	}

	async function request(stream = false, embeddings = false) {
		sequence++;
		const requestId = `strategy-${sequence}`;
		const response = await app.request(
			embeddings ? "/v1/embeddings" : "/v1/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
					"x-request-id": requestId,
				},
				body: JSON.stringify(
					embeddings
						? {
								model: "openai/text-embedding-3-small",
								input: `Strategy test ${sequence}`,
							}
						: {
								model: "openai/gpt-4.1",
								messages: [
									{ role: "user", content: `Strategy test ${sequence}` },
								],
								stream,
							},
				),
			},
		);
		const text = await response.text();
		expect(response.status, text).toBe(200);
		if (stream) {
			expect(text).toContain("[DONE]");
		}
		await waitForLogByRequestId(requestId);
	}

	it("balances initial chat requests without selecting the ordered fallback", async () => {
		const attempts = observeUpstream();
		for (let index = 0; index < 4; index++) {
			await request();
		}
		expect(attempts).toEqual(["pool-a", "pool-b", "pool-a", "pool-b"]);
	});
	it("balances initial embedding requests through the same selector", async () => {
		const attempts = observeUpstream();
		await request(false, true);
		await request(false, true);
		expect(attempts).toEqual(["pool-a", "pool-b"]);
	});
	it("tries the other pool member after a retryable credential failure", async () => {
		const attempts = observeUpstream(new Set(["pool-a"]));
		await request();
		expect(attempts).toEqual(["pool-a", "pool-b"]);
	});
	it("uses the ordered fallback after both pool members fail", async () => {
		const attempts = observeUpstream(new Set(["pool-a", "pool-b"]));
		await request();
		expect(attempts).toEqual(["pool-a", "pool-b", "ordered-fallback"]);
	});
	it("retains pool fallback before streaming output begins", async () => {
		const attempts = observeUpstream(new Set(["pool-a", "pool-b"]));
		await request(true);
		expect(attempts).toEqual(["pool-a", "pool-b", "ordered-fallback"]);
	});
}

describe("managed key strategies through the gateway", gatewayStrategyTests);
