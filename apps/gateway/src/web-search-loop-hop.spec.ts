import { afterEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

// Gateway-run web search sends each model call through an internal
// /v1/chat/completions hop. Every hop must carry the caller's IP, or a key
// restricted to an IP range fails the first search round.
describe("gateway-run web search hop", () => {
	const harness = createGatewayApiTestHarness();
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	function mockUpstream() {
		const modelCalls: Array<Record<string, any>> = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			const url =
				input instanceof Request ? input.url : new URL(String(input)).href;
			if (url.includes("perplexity.ai/search")) {
				return Response.json({
					results: [
						{ url: "https://news.test/race", title: "Race", snippet: "won" },
					],
				});
			}
			const body = JSON.parse(String(init?.body ?? "{}"));
			modelCalls.push(body);
			const searched = body.messages?.some(
				(m: { role: string }) => m.role === "tool",
			);
			return Response.json({
				id: "chatcmpl-hop",
				object: "chat.completion",
				created: 1,
				model: "gemma-4-31b-it",
				choices: [
					{
						index: 0,
						message: searched
							? { role: "assistant", content: "Answer" }
							: {
									role: "assistant",
									content: "",
									tool_calls: [
										{
											id: "call_1",
											type: "function",
											function: {
												name: "web_search",
												arguments: '{"query":"race winner"}',
											},
										},
									],
								},
						finish_reason: searched ? "stop" : "tool_calls",
					},
				],
				usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
			});
		});
		return modelCalls;
	}

	test.each([
		{ ip: "192.0.2.1", status: 200 },
		{ ip: "198.51.100.1", status: 403 },
	])("keeps IP rules on every round from $ip", async ({ ip, status }) => {
		vi.stubEnv("CLIENT_IP_HEADER", undefined);
		vi.stubEnv("LLM_DEEPINFRA_API_KEY", "deepinfra-test");
		vi.stubEnv("PERPLEXITY_SEARCH_API_KEY", "perplexity-test");
		await harness.setProjectMode("credits");
		await db.insert(tables.apiKey).values({
			id: "web-search-hop-key",
			description: "web search hop test key",
			...hashApiKeyForStorage("web-search-hop-token"),
			projectId: "project-id",
			createdBy: "user-id",
		});
		await db.insert(tables.apiKeyIamRule).values({
			id: "web-search-hop-allow",
			apiKeyId: "web-search-hop-key",
			ruleType: "allow_ip_cidrs",
			ruleValue: { ipCidrs: ["192.0.2.0/24"] },
			status: "active",
		});
		const modelCalls = mockUpstream();

		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: "Bearer web-search-hop-token",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify({
				model: "deepinfra/gemma-4-31b-it",
				messages: [{ role: "user", content: "Who won the race?" }],
				tools: [{ type: "web_search" }],
			}),
		});

		expect(response.status).toBe(status);
		if (status !== 200) {
			expect(modelCalls).toHaveLength(0);
			return;
		}
		const json = await response.json();
		expect(json.choices[0].message.content).toBe("Answer");
		expect(json.choices[0].message.annotations).toEqual([
			expect.objectContaining({
				url_citation: expect.objectContaining({
					url: "https://news.test/race",
				}),
			}),
		]);
		// Both rounds passed the IP rule and reached the model.
		expect(modelCalls).toHaveLength(2);
		expect(modelCalls[0].tools).toEqual([
			expect.objectContaining({
				function: expect.objectContaining({ name: "web_search" }),
			}),
		]);
	});
});
