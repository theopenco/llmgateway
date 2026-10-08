import { randomUUID } from "node:crypto";

import { describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import {
	applyAnthropicSafeguards,
	extractAnthropicSafeguards,
	isSafeguardBeta,
} from "./chat/tools/anthropic-safeguards.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

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

	test("apply merges the beta on Anthropic and strips everywhere else", () => {
		const passthrough = { safeguards: SAFEGUARDS, betas: [SAFEGUARD_BETA] };

		const body: Record<string, unknown> = {};
		const headers: Record<string, string> = {
			"anthropic-beta": `effort-2025-11-24,${SAFEGUARD_BETA}`,
		};
		applyAnthropicSafeguards("anthropic", body, headers, passthrough);
		expect(body.safeguards).toEqual(SAFEGUARDS);
		expect(headers["anthropic-beta"]).toBe(
			`effort-2025-11-24,${SAFEGUARD_BETA}`,
		);

		const otherBody: Record<string, unknown> = { safeguards: SAFEGUARDS };
		const otherHeaders: Record<string, string> = {};
		applyAnthropicSafeguards(
			"aws-bedrock",
			otherBody,
			otherHeaders,
			passthrough,
		);
		expect(otherBody.safeguards).toBeUndefined();
		expect(otherHeaders["anthropic-beta"]).toBeUndefined();

		// Claude on Google Cloud and Microsoft Foundry speaks the same Messages
		// format, but only Anthropic's own API is known to run the review.
		for (const provider of ["vertex-anthropic", "azure-anthropic"]) {
			const cloudBody: Record<string, unknown> = { safeguards: SAFEGUARDS };
			const cloudHeaders: Record<string, string> = {};
			applyAnthropicSafeguards(provider, cloudBody, cloudHeaders, passthrough);
			expect(cloudBody.safeguards).toBeUndefined();
			expect(cloudHeaders["anthropic-beta"]).toBeUndefined();
		}
	});
});

describe("/v1/messages Claude Code auto mode safeguards", () => {
	const harness = createGatewayApiTestHarness();

	async function seedAnthropicKey() {
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
				if (url.includes(`${harness.mockServerUrl}/v1/messages`)) {
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

	test("forwards safeguards with its beta and returns safeguard_results", async () => {
		await seedAnthropicKey();
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
				body: JSON.stringify({ ...toolTurn, safeguards: SAFEGUARDS }),
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
	});

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

	test("streams safeguard_results on the final message_delta", async () => {
		await seedAnthropicKey();
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
			expect(messageDelta?.delta?.safeguard_results).toEqual(SAFEGUARD_RESULTS);
			const toolStart = events.find(
				(e) =>
					e.type === "content_block_start" &&
					e.content_block?.type === "tool_use",
			);
			expect(toolStart?.content_block?.id).toBe("toolu_01SAFE");
		} finally {
			spy.mockRestore();
		}
	});
});
