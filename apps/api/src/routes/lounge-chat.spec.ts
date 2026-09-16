import {
	convertToModelMessages,
	dynamicTool,
	jsonSchema,
	simulateReadableStream,
	streamText,
} from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { app } from "@/index.js";
import { sealConnector } from "@/lib/connectors/crypto.js";
import { nativeTools } from "@/lib/connectors/native-tools.js";
import { createTestUser, deleteAll } from "@/testing.js";
import * as playgroundKey from "@/utils/playground-key.js";

import { db, tables } from "@llmgateway/db";
import { getLoungeToolApprovalSecret } from "@llmgateway/shared/lounge-tool-approval";
import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";
import type { UIMessage } from "ai";
import type { MockInstance } from "vitest";

vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => ({
	...(await importOriginal<typeof UrlSafety>()),
	fetchSafeUserUrl: vi.fn(),
}));

const userMessage: UIMessage = {
	id: "fixture-message",
	role: "user",
	parts: [{ type: "text", text: "Search my demo mailbox" }],
};
const model = "openai/gpt-4o-mini";
const usage = {
	inputTokens: {
		total: 1,
		noCache: 1,
		cacheRead: undefined,
		cacheWrite: undefined,
	},
	outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function upstreamResponse(
	deltas: Record<string, unknown>[],
	finish = "stop",
	fragmented = false,
) {
	const frames = deltas.map((delta) => ({
		id: "chatcmpl-fixture",
		object: "chat.completion.chunk",
		created: 1,
		model,
		choices: [{ index: 0, delta, finish_reason: null as string | null }],
	}));
	frames.push({
		id: "chatcmpl-fixture",
		object: "chat.completion.chunk",
		created: 1,
		model,
		choices: [{ index: 0, delta: {}, finish_reason: finish }],
	});
	const bytes = new TextEncoder().encode(
		frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("") +
			"data: [DONE]\r\n\r\n",
	);
	return new Response(
		new ReadableStream({
			start(controller) {
				for (
					let offset = 0;
					offset < bytes.length;
					offset += fragmented ? 7 : bytes.length
				) {
					controller.enqueue(
						bytes.slice(offset, offset + (fragmented ? 7 : bytes.length)),
					);
				}
				controller.close();
			},
		}),
		{ headers: { "Content-Type": "text/event-stream" } },
	);
}
function toolResponse() {
	return upstreamResponse(
		[
			{
				tool_calls: [
					{
						index: 0,
						id: "fixture-call",
						type: "function",
						function: {
							name: "gmail__search_messages",
							arguments: '{"query":',
						},
					},
				],
			},
			{ tool_calls: [{ index: 0, function: { arguments: '"demo"}' } }] },
		],
		"tool_calls",
		true,
	);
}
function events(content: string) {
	return content
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
		.map((line) =>
			z
				.object({ type: z.string() })
				.passthrough()
				.parse(JSON.parse(line.slice(6))),
		);
}

describe("native Lounge chat proposals", () => {
	let cookie: string;
	let upstream: MockInstance<typeof fetch>;
	beforeEach(async () => {
		cookie = await createTestUser();
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
		await db.insert(tables.loungeConnection).values({
			userId: "test-user-id",
			connectorId: "gmail",
			enabled: true,
			credentials: sealConnector(
				{ tokens: { access_token: "fixture-access", token_type: "Bearer" } },
				"test-user-id",
				"gmail",
			),
		});
		upstream = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => toolResponse());
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		vi.resetAllMocks();
		vi.unstubAllEnvs();
		await deleteAll();
	});
	function request(
		extra: Record<string, unknown> = {},
		headers: Record<string, string> = {
			Cookie: cookie,
			"x-llmgateway-key": "test-token",
		},
	) {
		return app.request("/lounge/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({
				model,
				messages: [userMessage],
				connectors: ["gmail"],
				...extra,
			}),
		});
	}
	async function proposal() {
		const response = await request();
		expect(response.status).toBe(200);
		const stream = events(await response.text());
		const approval = z
			.object({ approvalId: z.string(), signature: z.string() })
			.parse(stream.find((event) => event.type === "tool-approval-request"));
		return { stream, approval };
	}
	it("requires a session", async () => {
		expect((await request({}, {})).status).toBe(401);
		expect(upstream).not.toHaveBeenCalled();
	});
	it.each([
		{ connectors: ["custom"] },
		{ messages: [{ ...userMessage, parts: [{ type: "unknown" }] }] },
		{ temperature: 3 },
		{ maxTokens: 0 },
	])("rejects invalid requests before model billing: %j", async (body) => {
		expect((await request(body)).status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});
	it("checks paused, missing, and unconfigured connections", async () => {
		await db.update(tables.loungeConnection).set({ enabled: false });
		expect((await request()).status).toBe(409);
		await db.delete(tables.loungeConnection);
		expect((await request()).status).toBe(409);
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "");
		expect((await request()).status).toBe(503);
		expect(upstream).not.toHaveBeenCalled();
	});
	it("streams a signed proposal without calling the connected app", async () => {
		const { stream } = await proposal();
		expect(stream).toContainEqual(
			expect.objectContaining({
				type: "tool-input-available",
				toolName: "gmail__search_messages",
				input: { query: "demo" },
			}),
		);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
		expect(upstream).toHaveBeenCalledTimes(1);
	});
	it("uses a bearer session and preserves the selected billing key and model settings", async () => {
		const session = await db.query.session.findFirst();
		const fallback = vi.spyOn(playgroundKey, "resolvePlaygroundToken");
		const response = await request(
			{
				temperature: 0.3,
				maxTokens: 256,
				reasoningEffort: "high",
				webSearch: true,
				connectors: ["gmail", "gmail"],
			},
			{
				Authorization: `Bearer ${session!.token}`,
				"x-llmgateway-key": "test-token-no-retention",
			},
		);
		await response.text();
		expect(response.status).toBe(200);
		expect(fallback).not.toHaveBeenCalled();
		const init = upstream.mock.calls[0][1];
		const headers = new Headers(init?.headers);
		expect(headers.get("Authorization")).toBe("Bearer test-token-no-retention");
		expect(headers.get("x-no-fallback")).toBe("true");
		expect(headers.get("x-source")).toBe("lounge.llmgateway.io");
		const payload = JSON.parse(String(init?.body));
		expect(payload).toMatchObject({
			model,
			temperature: 0.3,
			reasoning_effort: "high",
			web_search: true,
		});
		expect(payload.max_tokens ?? payload.max_completion_tokens).toBe(256);
		expect(payload.tools).toHaveLength(nativeTools.gmail.length);
	});
	it("preserves reasoning and split UTF-8 citations from CRLF upstream events", async () => {
		upstream.mockImplementation(async () =>
			upstreamResponse(
				[
					{ reasoning: "Checking the source" },
					{
						content: "Résumé",
						annotations: [
							{
								type: "url_citation",
								url_citation: {
									url: "https://example.com/source",
									title: "Référence",
								},
							},
						],
					},
				],
				"stop",
				true,
			),
		);
		const stream = events(await (await request()).text());
		expect(stream).toContainEqual(
			expect.objectContaining({ type: "text-delta", delta: "Résumé" }),
		);
		expect(stream).toContainEqual(
			expect.objectContaining({
				type: "reasoning-delta",
				delta: "Checking the source",
			}),
		);
		expect(stream).toContainEqual(
			expect.objectContaining({
				type: "source-url",
				url: "https://example.com/source",
				title: "Référence",
			}),
		);
	});
	it.each(["approval-requested", "approval-responded"])(
		"does not execute or continue an unresolved %s call",
		async (state) => {
			const { approval } = await proposal();
			upstream.mockClear();
			const response = await request({
				messages: [
					userMessage,
					{
						id: "assistant",
						role: "assistant",
						parts: [
							{
								type: "dynamic-tool",
								toolName: "gmail__search_messages",
								toolCallId: "fixture-call",
								state,
								input: { query: "demo" },
								approval: {
									id: approval.approvalId,
									signature: approval.signature,
									...(state === "approval-responded" && { approved: true }),
								},
							},
						],
					},
				],
			});
			expect(response.status).toBe(400);
			expect(upstream).not.toHaveBeenCalled();
			expect(fetchSafeUserUrl).not.toHaveBeenCalled();
		},
	);
	it.each(["output-available", "output-error", "output-denied"] as const)(
		"continues recorded %s results without executing them again",
		async (state) => {
			const { approval } = await proposal();
			upstream
				.mockClear()
				.mockImplementation(async () =>
					upstreamResponse([{ content: "The recorded result is available." }]),
				);
			const part = {
				type: "dynamic-tool",
				toolName: "gmail__search_messages",
				toolCallId: "fixture-call",
				state,
				input: { query: "demo" },
				approval: {
					id: approval.approvalId,
					signature: approval.signature,
					approved: state !== "output-denied",
				},
				...(state === "output-available" && {
					output: { messages: [{ id: "demo-result" }] },
				}),
				...(state === "output-error" && {
					errorText: "The outcome is unknown. Review the connected app.",
				}),
			};
			const response = await request({
				connectors: [],
				messages: [
					userMessage,
					{ id: "assistant", role: "assistant", parts: [part] },
				],
			});
			expect(response.status).toBe(200);
			expect(await response.text()).toContain(
				"The recorded result is available.",
			);
			const payload = z
				.object({
					messages: z.array(
						z.object({ role: z.string(), content: z.unknown() }).passthrough(),
					),
				})
				.parse(JSON.parse(String(upstream.mock.calls[0][1]?.body)));
			expect(payload.messages.some((message) => message.role === "tool")).toBe(
				true,
			);
			expect(fetchSafeUserUrl).not.toHaveBeenCalled();
			expect(upstream).toHaveBeenCalledTimes(1);
		},
	);
	it("issues signatures that the web-style executor accepts for the same account", async () => {
		const { approval } = await proposal();
		const execute = vi.fn(async () => ({ messages: [] }));
		const messages: UIMessage[] = [
			userMessage,
			{
				id: "assistant",
				role: "assistant",
				parts: [
					{
						type: "dynamic-tool",
						toolName: "gmail__search_messages",
						toolCallId: "fixture-call",
						state: "approval-responded",
						input: { query: "demo" },
						approval: {
							id: approval.approvalId,
							signature: approval.signature,
							approved: true,
						},
					},
				],
			},
		];
		const result = streamText({
			model: new MockLanguageModelV4({
				doStream: async () => ({
					stream: simulateReadableStream({
						chunks: [
							{ type: "text-start", id: "answer" },
							{ type: "text-delta", id: "answer", delta: "Done" },
							{ type: "text-end", id: "answer" },
							{
								type: "finish",
								finishReason: { unified: "stop", raw: undefined },
								usage,
							},
						],
						chunkDelayInMs: null,
					}),
				}),
			}),
			messages: await convertToModelMessages(messages),
			tools: {
				gmail__search_messages: dynamicTool({
					inputSchema: jsonSchema(
						nativeTools.gmail[0].inputSchema as Record<string, unknown>,
					),
					execute,
				}),
			},
			toolApproval: () => "user-approval",
			experimental_toolApprovalSecret:
				getLoungeToolApprovalSecret("test-user-id"),
		});
		expect(await result.text).toBe("Done");
		expect(execute).toHaveBeenCalledTimes(1);
	});
	it("resolves personal billing only when no billing key is supplied", async () => {
		const fallback = vi
			.spyOn(playgroundKey, "resolvePlaygroundToken")
			.mockResolvedValue("test-token");
		const response = await request({}, { Cookie: cookie });
		await response.text();
		expect(fallback).toHaveBeenCalledTimes(1);
		expect(
			new Headers(upstream.mock.calls[0][1]?.headers).get("Authorization"),
		).toBe("Bearer test-token");
	});
	it("passes remote attachments to the gateway without fetching them in the API", async () => {
		upstream.mockImplementation(async () =>
			upstreamResponse([{ content: "I can read the attachment." }]),
		);
		const url = "https://example.com/attachment";
		const response = await request({
			messages: [
				{
					...userMessage,
					parts: [
						...userMessage.parts,
						{ type: "file", mediaType: "image/png", url },
					],
				},
			],
		});
		expect(await response.text()).toContain("I can read the attachment.");
		expect(upstream).toHaveBeenCalledTimes(1);
		expect(String(upstream.mock.calls[0][1]?.body)).toContain(url);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
	});
	it("aborts the upstream request when the client stops generation", async () => {
		upstream.mockImplementation(
			async (_input, init) =>
				await new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener(
						"abort",
						() => reject(new DOMException("Stopped", "AbortError")),
						{ once: true },
					);
				}),
		);
		const controller = new AbortController();
		const response = await app.request("/lounge/chat", {
			method: "POST",
			headers: {
				Cookie: cookie,
				"Content-Type": "application/json",
				"x-llmgateway-key": "test-token",
			},
			body: JSON.stringify({ model, messages: [userMessage], connectors: [] }),
			signal: controller.signal,
		});
		const content = response.text();
		await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
		controller.abort();
		expect(await content).toContain('"type":"abort"');
		expect(upstream.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});
	it.each([402, 503])(
		"reports upstream %s failures without automatically retrying",
		async (status) => {
			const rawError = vi.spyOn(console, "error");
			upstream.mockImplementation(async () =>
				Response.json(
					{ error: { message: "private provider detail" } },
					{ status },
				),
			);
			const content = await (await request()).text();
			expect(content).toContain(
				status === 402 ? "allowance is used up" : "could not complete",
			);
			expect(content).not.toContain("private provider detail");
			expect(rawError).not.toHaveBeenCalled();
			expect(upstream).toHaveBeenCalledTimes(1);
		},
	);
});
