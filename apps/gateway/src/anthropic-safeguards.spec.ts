import { randomUUID } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import {
	applyAnthropicSafeguards,
	extractAnthropicSafeguards,
	extractBedrockSafeguardResults,
	isSafeguardBeta,
	mappingSupportsAnthropicSafeguards,
} from "./chat/tools/anthropic-safeguards.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { buildAwsEventStreamMessage } from "./test-utils/mock-openai-server.js";

// Shapes taken from Claude Code's wire format (v2.1.292): the request carries
// `safeguards` plus the `dangerous-tool-use-*` beta, and Anthropic answers with
// `safeguard_results` keyed by tool_use id — on the final `message_delta` when
// streaming. https://code.claude.com/docs/en/auto-mode-classifier-billing
const SAFEGUARD_BETA = "dangerous-tool-use-2026-09-03";
const SAFEGUARDS = [
	{ type: "dangerous_tool_use", classifier_context: { mode: "auto" } },
];
const SAFEGUARD_RESULTS = [
	{
		type: "dangerous_tool_use",
		status: {
			type: "available",
			tool_uses: {
				toolu_01SAFE: { type: "evaluated", outcome: "allowed" },
			},
		},
	},
];

const SAFEGUARD_ROUTING_MODELS = [
	"anthropic/claude-opus-4-8",
	"claude-opus-4-8",
	"auto",
	"smart",
	"llmgateway/auto",
	"llmgateway/smart",
];

describe("anthropic safeguards helpers", () => {
	test("extract requires both the field and a safeguard beta", () => {
		expect(extractAnthropicSafeguards(SAFEGUARDS, undefined)).toBeUndefined();
		expect(
			extractAnthropicSafeguards(SAFEGUARDS, "interleaved-thinking-2025-05-14"),
		).toBeUndefined();
		expect(
			extractAnthropicSafeguards(undefined, SAFEGUARD_BETA),
		).toBeUndefined();
		expect(extractAnthropicSafeguards([], SAFEGUARD_BETA)).toBeUndefined();
		expect(
			extractAnthropicSafeguards(
				SAFEGUARDS,
				`interleaved-thinking-2025-05-14, ${SAFEGUARD_BETA}`,
			),
		).toEqual({ safeguards: SAFEGUARDS, betas: [SAFEGUARD_BETA] });
		expect(
			extractAnthropicSafeguards(SAFEGUARDS, "auto-mode-classifier-2026-07-16"),
		).toEqual({
			safeguards: SAFEGUARDS,
			betas: ["auto-mode-classifier-2026-07-16"],
		});
	});

	test("only dated safeguard betas are accepted", () => {
		for (const junk of [
			"dangerous-tool-use-",
			"dangerous-tool-use-latest",
			"dangerous-tool-use-2026-09-03,context-1m-2025-08-07",
			"auto-mode-classifier-2026-07-16x",
		]) {
			expect(isSafeguardBeta(junk)).toBe(false);
		}
	});

	test("apply merges the beta on Anthropic and Bedrock Messages, strips elsewhere", () => {
		const passthrough = { safeguards: SAFEGUARDS, betas: [SAFEGUARD_BETA] };

		const body: Record<string, unknown> = {};
		const headers: Record<string, string> = {
			"anthropic-beta": `effort-2025-11-24,${SAFEGUARD_BETA}`,
		};
		applyAnthropicSafeguards(
			"anthropic",
			"anthropic",
			body,
			headers,
			passthrough,
		);
		expect(body.safeguards).toEqual(SAFEGUARDS);
		expect(headers["anthropic-beta"]).toBe(
			`effort-2025-11-24,${SAFEGUARD_BETA}`,
		);

		// Claude on Bedrock's Messages endpoint takes the same body and header.
		const bedrockBody: Record<string, unknown> = {};
		const bedrockHeaders: Record<string, string> = {};
		applyAnthropicSafeguards(
			"aws-bedrock",
			"anthropic",
			bedrockBody,
			bedrockHeaders,
			passthrough,
		);
		expect(bedrockBody.safeguards).toEqual(SAFEGUARDS);
		expect(bedrockHeaders["anthropic-beta"]).toBe(SAFEGUARD_BETA);

		// Without a valid pair the field is stripped.
		const plainBody: Record<string, unknown> = { safeguards: SAFEGUARDS };
		applyAnthropicSafeguards(
			"anthropic",
			"anthropic",
			plainBody,
			{},
			undefined,
		);
		expect(plainBody.safeguards).toBeUndefined();

		// Claude on Google Cloud and Microsoft Foundry speaks the same Messages
		// format, but is not known to run the review.
		for (const provider of ["vertex-anthropic", "azure-anthropic"]) {
			const cloudBody: Record<string, unknown> = { safeguards: SAFEGUARDS };
			const cloudHeaders: Record<string, string> = {};
			applyAnthropicSafeguards(
				provider,
				provider,
				cloudBody,
				cloudHeaders,
				passthrough,
			);
			expect(cloudBody.safeguards).toBeUndefined();
			expect(cloudHeaders["anthropic-beta"]).toBeUndefined();
		}
	});

	test("apply puts both halves in Bedrock Converse model fields", () => {
		const body: Record<string, unknown> = {
			additionalModelRequestFields: {
				anthropic_beta: ["structured-outputs-2025-11-13"],
			},
			additionalModelResponseFieldPaths: ["/output_format"],
		};
		const headers: Record<string, string> = {};
		applyAnthropicSafeguards("aws-bedrock", "aws-bedrock", body, headers, {
			safeguards: SAFEGUARDS,
			betas: [SAFEGUARD_BETA],
		});
		expect(body.safeguards).toBeUndefined();
		expect(headers["anthropic-beta"]).toBeUndefined();
		expect(body.additionalModelRequestFields).toEqual({
			anthropic_beta: ["structured-outputs-2025-11-13", SAFEGUARD_BETA],
			safeguards: SAFEGUARDS,
		});
		expect(body.additionalModelResponseFieldPaths).toEqual([
			"/output_format",
			"/safeguard_results",
			"/delta/safeguard_results",
		]);
	});

	test("only Claude mappings on Bedrock support safeguards", () => {
		expect(
			mappingSupportsAnthropicSafeguards({
				providerId: "anthropic",
				externalId: "claude-opus-4-8",
			}),
		).toBe(true);
		for (const apiFormat of [undefined, "anthropic-messages"] as const) {
			expect(
				mappingSupportsAnthropicSafeguards({
					providerId: "aws-bedrock",
					externalId: "anthropic.claude-opus-4-8",
					apiFormat,
				}),
			).toBe(true);
		}
		expect(
			mappingSupportsAnthropicSafeguards({
				providerId: "aws-bedrock",
				externalId: "moonshotai.kimi-k3",
				apiFormat: "openai-chat-completions",
			}),
		).toBe(false);
		expect(
			mappingSupportsAnthropicSafeguards({
				providerId: "vertex-anthropic",
				externalId: "claude-opus-4-8",
			}),
		).toBe(false);
	});

	test("reads Bedrock verdicts from converse and converse-stream fields", () => {
		expect(
			extractBedrockSafeguardResults({ safeguard_results: SAFEGUARD_RESULTS }),
		).toEqual(SAFEGUARD_RESULTS);
		expect(
			extractBedrockSafeguardResults({
				delta: { safeguard_results: SAFEGUARD_RESULTS },
			}),
		).toEqual(SAFEGUARD_RESULTS);
		expect(
			extractBedrockSafeguardResults({ safeguard_results: [] }),
		).toBeUndefined();
		expect(extractBedrockSafeguardResults(undefined)).toBeUndefined();
	});
});

describe("/v1/messages Claude Code auto mode safeguards", () => {
	const harness = createGatewayApiTestHarness();

	async function seedAnthropicKey() {
		await db
			.update(tables.organization)
			.set({
				smartRoutingConfig: { classifier: "none", models: ["claude-opus-4-8"] },
			})
			.where(eq(tables.organization.id, "org-id"));
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("real-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "provider-key-id",
			...encryptProviderKeyForStorage(
				"sk-test-key",
				"provider-key-id",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	function captureAnthropicUpstream(respond: () => Response) {
		const originalFetch = globalThis.fetch;
		const seen: { body: any; headers: Headers | null } = {
			body: null,
			headers: null,
		};
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				if (
					url.includes(`${harness.mockServerUrl}/v1/messages`) ||
					url.includes(`${harness.mockServerUrl}/anthropic/v1/messages`)
				) {
					const body =
						input instanceof Request ? await input.text() : String(init?.body);
					seen.body = JSON.parse(body);
					seen.headers = new Headers(init?.headers);
					return respond();
				}
				return await originalFetch(input as RequestInfo | URL, init);
			});
		return { spy, seen };
	}

	const toolTurn = {
		model: "anthropic/claude-opus-4-8",
		max_tokens: 1024,
		messages: [{ role: "user", content: "Run ls" }],
		tools: [
			{
				name: "Bash",
				description: "Run a shell command",
				input_schema: {
					type: "object",
					properties: { command: { type: "string" } },
				},
			},
		],
	};

	test.each(SAFEGUARD_ROUTING_MODELS)(
		"forwards safeguards and returns verdicts for %s",
		async (model) => {
			await seedAnthropicKey();
			await seedOtherProvider("aws-bedrock");
			const { spy, seen } = captureAnthropicUpstream(
				() =>
					new Response(
						JSON.stringify({
							id: "msg_safeguards",
							type: "message",
							role: "assistant",
							model: "claude-opus-4-8",
							content: [
								{
									type: "tool_use",
									id: "toolu_01SAFE",
									name: "Bash",
									input: { command: "ls" },
								},
							],
							stop_reason: "tool_use",
							stop_sequence: null,
							usage: { input_tokens: 100, output_tokens: 5 },
							safeguard_results: SAFEGUARD_RESULTS,
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
			);

			try {
				const res = await app.request("/v1/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
						"anthropic-beta": `interleaved-thinking-2025-05-14,${SAFEGUARD_BETA}`,
					},
					body: JSON.stringify({ ...toolTurn, model, safeguards: SAFEGUARDS }),
				});

				expect(res.status).toBe(200);
				expect(seen.body.safeguards).toEqual(SAFEGUARDS);
				const betas = (seen.headers?.get("anthropic-beta") ?? "").split(",");
				expect(betas).toContain(SAFEGUARD_BETA);

				const json = await res.json();
				expect(json.safeguard_results).toEqual(SAFEGUARD_RESULTS);
				const toolUse = json.content.find((b: any) => b.type === "tool_use");
				expect(toolUse.id).toBe("toolu_01SAFE");
			} finally {
				spy.mockRestore();
			}
		},
	);

	test("drops safeguards when its beta is missing", async () => {
		await seedAnthropicKey();
		const { spy, seen } = captureAnthropicUpstream(
			() =>
				new Response(
					JSON.stringify({
						id: "msg_no_beta",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-8",
						content: [{ type: "text", text: "ok" }],
						stop_reason: "end_turn",
						stop_sequence: null,
						usage: { input_tokens: 10, output_tokens: 1 },
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);

		try {
			const res = await app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-no-fallback": "true",
				},
				body: JSON.stringify({ ...toolTurn, safeguards: SAFEGUARDS }),
			});

			expect(res.status).toBe(200);
			// The field without its beta is a hard 400 upstream, so neither half is
			// sent and Claude Code falls back to its own classifier.
			expect(seen.body.safeguards).toBeUndefined();
			expect(seen.headers?.get("anthropic-beta") ?? "").not.toContain(
				"dangerous-tool-use",
			);
			const json = await res.json();
			expect(json.safeguard_results).toBeUndefined();
		} finally {
			spy.mockRestore();
		}
	});

	test("a cached reply without verdicts does not answer a safeguards request", async () => {
		await seedAnthropicKey();
		await db
			.update(tables.project)
			.set({ cachingEnabled: true })
			.where(eq(tables.project.id, "project-id"));

		let calls = 0;
		const { spy } = captureAnthropicUpstream(() => {
			calls++;
			return new Response(
				JSON.stringify({
					id: `msg_cache_${calls}`,
					type: "message",
					role: "assistant",
					model: "claude-opus-4-8",
					content: [{ type: "text", text: "ok" }],
					stop_reason: "end_turn",
					stop_sequence: null,
					usage: { input_tokens: 10, output_tokens: 1 },
					...(calls > 1 && { safeguard_results: SAFEGUARD_RESULTS }),
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const turn = {
			...toolTurn,
			messages: [{ role: "user", content: `Run ls ${randomUUID()}` }],
		};
		const send = (headers: Record<string, string>, body: unknown) =>
			app.request("/v1/messages", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer real-token",
					"x-no-fallback": "true",
					...headers,
				},
				body: JSON.stringify(body),
			});

		// setCache is a no-op under NODE_ENV=test, so briefly flip it to prime
		// the cache the way production would.
		const originalNodeEnv = process.env.NODE_ENV;
		try {
			try {
				process.env.NODE_ENV = "development";
				const plain = await send({}, turn);
				expect(plain.status).toBe(200);
				expect((await plain.json()).safeguard_results).toBeUndefined();
			} finally {
				process.env.NODE_ENV = originalNodeEnv;
			}

			// Control: the plain request is now served from cache.
			const replay = await send({}, turn);
			expect(replay.headers.get("x-llmgateway-cache")).toBe("HIT");
			expect(calls).toBe(1);

			const guarded = await send(
				{ "anthropic-beta": SAFEGUARD_BETA },
				{ ...turn, safeguards: SAFEGUARDS },
			);
			expect(guarded.status).toBe(200);
			expect(guarded.headers.get("x-llmgateway-cache")).toBeNull();
			expect(calls).toBe(2);
			expect((await guarded.json()).safeguard_results).toEqual(
				SAFEGUARD_RESULTS,
			);
		} finally {
			spy.mockRestore();
		}
	});

	test.each(SAFEGUARD_ROUTING_MODELS)(
		"streams safeguard_results for %s",
		async (model) => {
			await seedAnthropicKey();
			await seedOtherProvider("aws-bedrock");
			const frame = (event: string, data: unknown) =>
				`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
			const sse = [
				frame("message_start", {
					type: "message_start",
					message: {
						id: "msg_stream_safeguards",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-8",
						content: [],
						usage: { input_tokens: 100, output_tokens: 0 },
					},
				}),
				frame("content_block_start", {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "toolu_01SAFE",
						name: "Bash",
						input: {},
					},
				}),
				frame("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '{"command":"ls"}' },
				}),
				frame("content_block_stop", { type: "content_block_stop", index: 0 }),
				frame("message_delta", {
					type: "message_delta",
					delta: {
						stop_reason: "tool_use",
						stop_sequence: null,
						safeguard_results: SAFEGUARD_RESULTS,
					},
					usage: { output_tokens: 12 },
				}),
				frame("message_stop", { type: "message_stop" }),
			].join("");
			const { spy, seen } = captureAnthropicUpstream(
				() =>
					new Response(
						new ReadableStream({
							start(controller) {
								controller.enqueue(new TextEncoder().encode(sse));
								controller.close();
							},
						}),
						{ status: 200, headers: { "Content-Type": "text/event-stream" } },
					),
			);

			try {
				const res = await app.request("/v1/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
						"anthropic-beta": SAFEGUARD_BETA,
					},
					body: JSON.stringify({
						...toolTurn,
						model,
						stream: true,
						safeguards: SAFEGUARDS,
					}),
				});

				expect(res.status).toBe(200);
				expect(seen.body.safeguards).toEqual(SAFEGUARDS);
				const text = await res.text();
				const events = text
					.split("\n")
					.filter((line) => line.startsWith("data: "))
					.map((line) => JSON.parse(line.slice(6)));
				const messageDelta = events.find((e) => e.type === "message_delta");
				expect(messageDelta?.delta?.safeguard_results).toEqual(
					SAFEGUARD_RESULTS,
				);
				const toolStart = events.find(
					(e) =>
						e.type === "content_block_start" &&
						e.content_block?.type === "tool_use",
				);
				expect(toolStart?.content_block?.id).toBe("toolu_01SAFE");
			} finally {
				spy.mockRestore();
			}
		},
	);

	async function seedOtherProvider(provider: string, name?: string) {
		const id = `key-${provider}`;
		await db.insert(tables.providerKey).values({
			id,
			...encryptProviderKeyForStorage("test-provider-key", id, "org-id"),
			provider,
			name,
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
		});
	}

	function sendSafeguards(model: string, stream = false, headers = {}) {
		return app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer real-token",
				"anthropic-beta": SAFEGUARD_BETA,
				...headers,
			},
			body: JSON.stringify({
				...toolTurn,
				model,
				stream,
				safeguards: SAFEGUARDS,
			}),
		});
	}

	test.each(["vertex-anthropic", "azure-anthropic"])(
		"rejects an explicit %s pin before upstream, including streaming",
		async (provider) => {
			await seedAnthropicKey();
			await seedOtherProvider(provider);
			const spy = vi.spyOn(globalThis, "fetch");
			try {
				for (const stream of [false, true]) {
					const res = await sendSafeguards(
						`${provider}/${provider === "azure-anthropic" ? "claude-opus-4-8" : "claude-sonnet-4-6"}`,
						stream,
					);
					expect(res.status).toBe(400);
					expect(res.headers.get("content-type")).toContain("application/json");
					expect((await res.json()).error.message).toContain(
						"CLAUDE_CODE_AUTO_MODE_SERVER=0",
					);
				}
				expect(spy).not.toHaveBeenCalled();
			} finally {
				spy.mockRestore();
			}
		},
	);

	test.each(["custom", "llmgateway/custom", "my-provider/claude-opus-4-8"])(
		"rejects unsupported custom transport %s even with an Anthropic key",
		async (model) => {
			await seedAnthropicKey();
			await seedOtherProvider("custom", "my-provider");
			const spy = vi.spyOn(globalThis, "fetch");
			try {
				for (const stream of [false, true]) {
					const res = await sendSafeguards(model, stream);
					expect(res.status).toBe(400);
					expect((await res.json()).error.message).toContain(
						"No compatible provider",
					);
				}
				expect(spy).not.toHaveBeenCalled();
			} finally {
				spy.mockRestore();
			}
		},
	);

	test("rejects a non-Claude Bedrock pin before upstream", async () => {
		await seedAnthropicKey();
		await seedOtherProvider("aws-bedrock");
		const spy = vi.spyOn(globalThis, "fetch");
		try {
			const res = await sendSafeguards("aws-bedrock/kimi-k3");
			expect(res.status).toBe(400);
			expect((await res.json()).error.message).toContain(
				"CLAUDE_CODE_AUTO_MODE_SERVER=0",
			);
			expect(spy).not.toHaveBeenCalled();
		} finally {
			spy.mockRestore();
		}
	});

	async function seedBedrockOnly() {
		await seedAnthropicKey();
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.id, "provider-key-id"));
		await seedOtherProvider("aws-bedrock");
	}

	test("forwards safeguards to Claude on Bedrock's Messages API", async () => {
		await seedBedrockOnly();
		const { spy, seen } = captureAnthropicUpstream(
			() =>
				new Response(
					JSON.stringify({
						id: "msg_bedrock",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-8",
						content: [
							{
								type: "tool_use",
								id: "toolu_01SAFE",
								name: "Bash",
								input: { command: "ls" },
							},
						],
						stop_reason: "tool_use",
						usage: { input_tokens: 100, output_tokens: 5 },
						safeguard_results: SAFEGUARD_RESULTS,
					}),
					{ headers: { "Content-Type": "application/json" } },
				),
		);
		try {
			const res = await sendSafeguards("aws-bedrock/claude-opus-4-8", false, {
				"x-no-fallback": "true",
			});
			expect(res.status).toBe(200);
			expect(seen.body.safeguards).toEqual(SAFEGUARDS);
			expect(seen.headers?.get("anthropic-beta") ?? "").toContain(
				SAFEGUARD_BETA,
			);
			expect((await res.json()).safeguard_results).toEqual(SAFEGUARD_RESULTS);
		} finally {
			spy.mockRestore();
		}
	});

	// A Claude mapping Bedrock still serves through the Converse API.
	const CONVERSE_MODEL = "aws-bedrock/claude-opus-4-5-20251101";

	function captureBedrockConverse(respond: () => Response) {
		const originalFetch = globalThis.fetch;
		const seen: { body: any; url: string | null } = { body: null, url: null };
		const spy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async (input, init) => {
				const url =
					typeof input === "string"
						? input
						: input instanceof URL
							? input.toString()
							: input.url;
				if (url.startsWith(`${harness.mockServerUrl}/model/`)) {
					seen.url = url;
					seen.body = JSON.parse(String(init?.body));
					return respond();
				}
				return await originalFetch(input as RequestInfo | URL, init);
			});
		return { spy, seen };
	}

	function expectConverseSafeguards(body: any) {
		expect(body.safeguards).toBeUndefined();
		expect(body.additionalModelRequestFields.safeguards).toEqual(SAFEGUARDS);
		expect(body.additionalModelRequestFields.anthropic_beta).toContain(
			SAFEGUARD_BETA,
		);
		expect(body.additionalModelResponseFieldPaths).toEqual(
			expect.arrayContaining([
				"/safeguard_results",
				"/delta/safeguard_results",
			]),
		);
	}

	test("forwards safeguards through Bedrock Converse and returns verdicts", async () => {
		await seedBedrockOnly();
		const { spy, seen } = captureBedrockConverse(
			() =>
				new Response(
					JSON.stringify({
						output: {
							message: {
								role: "assistant",
								content: [
									{
										toolUse: {
											toolUseId: "toolu_bdrk_01SAFE",
											name: "Bash",
											input: { command: "ls" },
										},
									},
								],
							},
						},
						stopReason: "tool_use",
						usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
						additionalModelResponseFields: {
							safeguard_results: SAFEGUARD_RESULTS,
						},
					}),
					{ headers: { "Content-Type": "application/json" } },
				),
		);
		try {
			const res = await sendSafeguards(CONVERSE_MODEL, false, {
				"x-no-fallback": "true",
			});
			expect(res.status).toBe(200);
			expect(seen.url).toContain("/converse");
			expectConverseSafeguards(seen.body);
			const json = await res.json();
			expect(json.safeguard_results).toEqual(SAFEGUARD_RESULTS);
			expect(json.content.find((b: any) => b.type === "tool_use")?.id).toBe(
				"toolu_bdrk_01SAFE",
			);
		} finally {
			spy.mockRestore();
		}
	});

	test("streams Bedrock Converse verdicts from messageStop", async () => {
		await seedBedrockOnly();
		const frames = [
			buildAwsEventStreamMessage("messageStart", { role: "assistant" }),
			buildAwsEventStreamMessage("contentBlockStart", {
				contentBlockIndex: 0,
				start: { toolUse: { toolUseId: "toolu_bdrk_01SAFE", name: "Bash" } },
			}),
			buildAwsEventStreamMessage("contentBlockDelta", {
				contentBlockIndex: 0,
				delta: { toolUse: { input: '{"command":"ls"}' } },
			}),
			buildAwsEventStreamMessage("contentBlockStop", { contentBlockIndex: 0 }),
			buildAwsEventStreamMessage("messageStop", {
				stopReason: "tool_use",
				additionalModelResponseFields: {
					delta: { safeguard_results: SAFEGUARD_RESULTS },
				},
			}),
			buildAwsEventStreamMessage("metadata", {
				usage: { inputTokens: 100, outputTokens: 5, totalTokens: 105 },
				metrics: { latencyMs: 10 },
			}),
		];
		const { spy, seen } = captureBedrockConverse(
			() =>
				new Response(
					new ReadableStream({
						start(controller) {
							for (const frame of frames) {
								controller.enqueue(frame);
							}
							controller.close();
						},
					}),
					{ headers: { "Content-Type": "application/vnd.amazon.eventstream" } },
				),
		);
		try {
			const res = await sendSafeguards(CONVERSE_MODEL, true, {
				"x-no-fallback": "true",
			});
			expect(res.status).toBe(200);
			const text = await res.text();
			expect(seen.url).toContain("/converse-stream");
			expectConverseSafeguards(seen.body);
			const events = text
				.split("\n")
				.filter((line) => line.startsWith("data: "))
				.map((line) => JSON.parse(line.slice(6)));
			const messageDelta = events.find((e) => e.type === "message_delta");
			expect(messageDelta?.delta?.safeguard_results).toEqual(SAFEGUARD_RESULTS);
			const toolStart = events.find(
				(e) =>
					e.type === "content_block_start" &&
					e.content_block?.type === "tool_use",
			);
			expect(toolStart?.content_block?.id).toBe("toolu_bdrk_01SAFE");
		} finally {
			spy.mockRestore();
		}
	});

	test("automatic model selection rejects when only an incompatible key is available", async () => {
		await seedAnthropicKey();
		await db
			.delete(tables.providerKey)
			.where(eq(tables.providerKey.id, "provider-key-id"));
		await seedOtherProvider("azure-anthropic");
		const res = await sendSafeguards("auto");
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain(
			"No compatible provider",
		);
	});

	test("an incompatible saved session pin yields to the safeguard requirement", async () => {
		await seedAnthropicKey();
		await seedOtherProvider("azure-anthropic");
		const sessionId = "safeguards-session";
		const key = `session_provider:org-id:claude-opus-4-8:${sessionId}`;
		await redisClient.set(
			key,
			JSON.stringify({ providerId: "azure-anthropic" }),
			"EX",
			3600,
		);
		const { spy, seen } = captureAnthropicUpstream(
			() =>
				new Response(
					JSON.stringify({
						id: "msg_sticky",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-8",
						content: [{ type: "text", text: "ok" }],
						stop_reason: "end_turn",
						usage: { input_tokens: 10, output_tokens: 1 },
						safeguard_results: SAFEGUARD_RESULTS,
					}),
					{ headers: { "Content-Type": "application/json" } },
				),
		);
		try {
			const res = await sendSafeguards("claude-opus-4-8", false, {
				"x-session-id": sessionId,
			});
			expect(res.status).toBe(200);
			expect((await res.json()).safeguard_results).toEqual(SAFEGUARD_RESULTS);
			expect(seen.body.safeguards).toEqual(SAFEGUARDS);
			expect(JSON.parse((await redisClient.get(key)) ?? "null")).toMatchObject({
				providerId: "anthropic",
			});
		} finally {
			spy.mockRestore();
		}
	});

	test.each([false, true])(
		"upstream failure never falls back to an incompatible provider (stream=%s)",
		async (stream) => {
			await seedAnthropicKey();
			await seedOtherProvider("azure-anthropic");
			const { spy, seen } = captureAnthropicUpstream(
				() =>
					new Response(
						JSON.stringify({
							error: { type: "overloaded_error", message: "Overloaded" },
						}),
						{ status: 503, headers: { "Content-Type": "application/json" } },
					),
			);
			try {
				const res = await sendSafeguards("claude-opus-4-8", stream);
				const body = await res.text();
				expect(body).toContain("error");
				expect(seen.body.safeguards).toEqual(SAFEGUARDS);
				expect(spy.mock.calls.length).toBeGreaterThan(0);
				for (const [input] of spy.mock.calls) {
					const url = input instanceof Request ? input.url : String(input);
					expect(url).toContain(`${harness.mockServerUrl}/v1/messages`);
				}
			} finally {
				spy.mockRestore();
			}
		},
	);

	test.each(["beta-only", "body-only", "unrelated-beta"])(
		"%s does not restrict an unsupported provider",
		async (mode) => {
			await seedAnthropicKey();
			await seedOtherProvider("azure-anthropic");
			const { spy, seen } = captureAnthropicUpstream(
				() =>
					new Response(
						JSON.stringify({
							id: "msg_plain",
							type: "message",
							role: "assistant",
							model: "claude-opus-4-8",
							content: [{ type: "text", text: "ok" }],
							stop_reason: "end_turn",
							usage: { input_tokens: 10, output_tokens: 1 },
						}),
						{ headers: { "Content-Type": "application/json" } },
					),
			);
			try {
				const res = await app.request("/v1/messages", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer real-token",
						"x-no-fallback": "true",
						...(mode !== "body-only" && {
							"anthropic-beta":
								mode === "beta-only"
									? SAFEGUARD_BETA
									: "interleaved-thinking-2025-05-14",
						}),
					},
					body: JSON.stringify({
						...toolTurn,
						model: "azure-anthropic/claude-opus-4-8",
						...(mode !== "beta-only" && { safeguards: SAFEGUARDS }),
					}),
				});
				expect(res.status).toBe(200);
				expect(seen.body.safeguards).toBeUndefined();
				expect(seen.headers?.get("anthropic-beta") ?? "").not.toContain(
					SAFEGUARD_BETA,
				);
			} finally {
				spy.mockRestore();
			}
		},
	);
});
