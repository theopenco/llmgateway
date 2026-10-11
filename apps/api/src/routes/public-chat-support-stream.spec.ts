import {
	createServer,
	type Server,
	type ServerResponse,
	type IncomingHttpHeaders,
} from "node:http";

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { app } from "@/index.js";
import {
	fetchKnowledgePage,
	getCatalogueSummary,
} from "@/utils/chat-support-knowledge.js";

import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { randomInt, uniqueId } from "@llmgateway/shared/random";

import type { AddressInfo } from "node:net";

vi.mock("@/utils/chat-support-knowledge.js", () => ({
	fetchKnowledgePage: vi.fn(),
	getCatalogueSummary: vi.fn(async () => null),
	getKnowledgeOverviews: vi.fn(async () => []),
	getKnowledgeReferenceDocs: vi.fn(async () => []),
	getKnowledgeUrls: vi.fn(async () => []),
}));

const UPSTREAM_MESSAGE = "upstream detail that must not reach the visitor";

// Fails after the stream has started, like an upstream error relayed mid-stream.
function streamError(res: ServerResponse): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	res.write(
		`data: ${JSON.stringify({
			id: "chatcmpl-1",
			object: "chat.completion.chunk",
			created: 0,
			model: "smart",
			choices: [{ index: 0, delta: { role: "assistant" } }],
		})}\n\n`,
	);
	res.end(
		`data: ${JSON.stringify({
			error: {
				message: UPSTREAM_MESSAGE,
				type: "upstream_error",
				code: "rate_limit_exceeded",
			},
		})}\n\n`,
	);
}

function streamReply(res: ServerResponse, text: string): void {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"x-llmgateway-smart-model": "test-model",
	});
	res.end(
		`data: ${JSON.stringify({
			id: "chatcmpl-test",
			object: "chat.completion.chunk",
			created: 0,
			model: "test-model",
			choices: [{ index: 0, delta: { content: text }, finish_reason: "stop" }],
			usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
		})}\n\ndata: [DONE]\n\n`,
	);
}

async function requestSupport(clientId = uniqueId("spec")) {
	return await app.request("/public/chat-support", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Forwarded-For": `10.250.${randomInt(0, 256)}.${randomInt(0, 256)}`,
		},
		body: JSON.stringify({
			clientId,
			messages: [
				{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
			],
		}),
	});
}

describe("public chat support diagnostics", () => {
	let server: Server;
	let respond = streamError;
	let gatewayRequestIds: (string | string[] | undefined)[];
	let gatewayHeaders: IncomingHttpHeaders;

	beforeEach(() => {
		respond = streamError;
		gatewayRequestIds = [];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	beforeAll(async () => {
		server = createServer((req, res) => {
			gatewayHeaders = req.headers;
			gatewayRequestIds.push(req.headers["x-request-id"]);
			respond(res);
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const { port } = server.address() as AddressInfo;
		vi.stubEnv("GATEWAY_BACKEND_URL", `http://127.0.0.1:${port}`);
		vi.stubEnv("SUPPORT_CHAT_API_KEY", "test-support-key");
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		await new Promise((resolve) => server.close(resolve));
	});

	it("logs one upstream warning and forwards a safe message", async () => {
		const consoleError = vi.spyOn(console, "error");
		const loggerError = vi.spyOn(logger, "error");
		const loggerWarn = vi.spyOn(logger, "warn");
		const loggerInfo = vi.spyOn(logger, "info");

		const res = await app.request("/public/chat-support", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Forwarded-For": `10.250.${randomInt(0, 256)}.${randomInt(0, 256)}`,
			},
			body: JSON.stringify({
				clientId: uniqueId("spec"),
				messages: [
					{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] },
				],
			}),
		});
		const body = await res.text();

		expect(res.status).toBe(200);
		expect(body).toContain('"type":"error"');
		expect(body).toContain(
			"The assistant could not answer right now. Please try again.",
		);
		expect(body).not.toContain(UPSTREAM_MESSAGE);

		const isStreamLog = ([message]: unknown[]) =>
			message === "Chat support streaming error";
		expect(loggerWarn.mock.calls.filter(isStreamLog)).toHaveLength(1);
		expect(loggerError.mock.calls.filter(isStreamLog)).toHaveLength(0);
		expect(consoleError).not.toHaveBeenCalled();
		expect(loggerWarn).toHaveBeenCalledWith(
			"Chat support streaming error",
			expect.objectContaining({
				conversationId: expect.any(String),
				requestId: expect.any(String),
				gatewayRequestId: gatewayRequestIds[0],
				code: "rate_limit_exceeded",
				stage: "generation",
				outcome: "failed",
			}),
		);
		expect(JSON.stringify(loggerWarn.mock.calls)).not.toContain(
			UPSTREAM_MESSAGE,
		);
		expect(loggerInfo).toHaveBeenCalledWith(
			"Chat support request finished",
			expect.objectContaining({ outcome: "failed" }),
		);

		consoleError.mockRestore();
		loggerError.mockRestore();
		loggerWarn.mockRestore();
	});

	it("correlates a successful reply with its conversation and gateway request", async () => {
		respond = (res) => streamReply(res, "A helpful answer");
		const info = vi.spyOn(logger, "info");
		const clientId = uniqueId("spec");
		const res = await requestSupport(clientId);
		expect(await res.text()).toContain("A helpful answer");
		const conversation = await db.query.chatSupportConversation.findFirst({
			where: { clientId },
		});
		expect(info).toHaveBeenCalledWith(
			"Chat support request finished",
			expect.objectContaining({
				conversationId: conversation!.id,
				gatewayRequestId: gatewayRequestIds[0],
				outcome: "completed",
				stepCount: 1,
				inputTokens: 10,
				outputTokens: 5,
			}),
		);
		expect(info).toHaveBeenCalledWith(
			"Chat support gateway response received",
			expect.objectContaining({ selectedModel: "test-model", statusCode: 200 }),
		);
		const saved = await db.query.chatSupportMessage.findMany({
			where: { conversationId: conversation!.id, role: "assistant" },
		});
		expect(saved.map((message) => message.content)).toEqual([
			"A helpful answer",
		]);
		expect(JSON.stringify(info.mock.calls)).not.toContain("A helpful answer");
	});

	it("warns when generation ends without an answer", async () => {
		respond = (res) => streamReply(res, "");
		const warn = vi.spyOn(logger, "warn");
		const res = await requestSupport();
		await res.text();
		expect(warn).toHaveBeenCalledWith(
			"Chat support request finished",
			expect.objectContaining({
				outcome: "empty",
				finishReason: "stop",
				textLength: 0,
			}),
		);
	});

	it("records knowledge preparation failures before streaming starts", async () => {
		vi.mocked(getCatalogueSummary).mockRejectedValueOnce(
			new Error("knowledge unavailable"),
		);
		const error = vi.spyOn(logger, "error");
		const res = await requestSupport();
		expect(res.status).toBe(500);
		expect(gatewayRequestIds).toHaveLength(0);
		expect(error).toHaveBeenCalledWith(
			"Chat support request failed",
			expect.objectContaining({
				stage: "knowledge",
				conversationId: expect.any(String),
				outcome: "failed",
			}),
		);
	});

	it("records missing configuration against the saved conversation", async () => {
		const previous = process.env.SUPPORT_CHAT_API_KEY;
		delete process.env.SUPPORT_CHAT_API_KEY;
		try {
			const error = vi.spyOn(logger, "error");
			const res = await requestSupport();
			expect(res.status).toBe(503);
			expect(error).toHaveBeenCalledWith(
				"SUPPORT_CHAT_API_KEY not configured",
				expect.objectContaining({
					stage: "configuration",
					conversationId: expect.any(String),
				}),
			);
		} finally {
			process.env.SUPPORT_CHAT_API_KEY = previous;
		}
	});

	it("distinguishes escalation from a failed or empty assistant reply", async () => {
		const clientId = uniqueId("spec");
		const [conversation] = await db
			.insert(tables.chatSupportConversation)
			.values({
				clientId,
				escalatedAt: new Date(),
			})
			.returning();
		const info = vi.spyOn(logger, "info");
		const res = await requestSupport(clientId);
		expect(await res.text()).toContain("data: [DONE]");
		expect(gatewayRequestIds).toHaveLength(0);
		expect(info).toHaveBeenCalledWith(
			"Chat support request finished",
			expect.objectContaining({
				conversationId: conversation!.id,
				outcome: "escalated",
			}),
		);
		await db
			.delete(tables.chatSupportConversation)
			.where(eq(tables.chatSupportConversation.id, conversation!.id));
	});

	it("preserves only the configured client IP header while adding correlation", async () => {
		const previous = process.env.CLIENT_IP_HEADER;
		process.env.CLIENT_IP_HEADER = "X-Client-Ip";
		respond = (res) => streamReply(res, "Answer");
		try {
			const res = await app.request("/public/chat-support", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Client-Ip": "203.0.113.10",
					"X-Forwarded-For": "203.0.113.20",
				},
				body: JSON.stringify({
					clientId: uniqueId("spec"),
					messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
				}),
			});
			await res.text();
			expect(gatewayHeaders["x-client-ip"]).toBe("203.0.113.10");
			expect(gatewayHeaders["x-forwarded-for"]).toBeUndefined();
			expect(gatewayHeaders["x-source"]).toBe("support-chat");
			expect(gatewayHeaders["x-request-id"]).toEqual(expect.any(String));
		} finally {
			if (previous === undefined) {
				delete process.env.CLIENT_IP_HEADER;
			} else {
				process.env.CLIENT_IP_HEADER = previous;
			}
		}
	});

	it("correlates a failure after a completed tool step with the failing gateway call", async () => {
		vi.mocked(fetchKnowledgePage).mockResolvedValueOnce("Public documentation");
		respond = (res) => {
			if (gatewayRequestIds.length > 1) {
				streamError(res);
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(
				`data: ${JSON.stringify({
					id: "chatcmpl-tool",
					object: "chat.completion.chunk",
					created: 0,
					model: "test-model",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "tool-1",
										type: "function",
										function: {
											name: "fetchPage",
											arguments: JSON.stringify({
												url: "https://docs.llmgateway.io/learn/organizations",
											}),
										},
									},
								],
							},
							finish_reason: "tool_calls",
						},
					],
				})}\n\ndata: [DONE]\n\n`,
			);
		};
		const warn = vi.spyOn(logger, "warn");
		const info = vi.spyOn(logger, "info");
		const res = await requestSupport();
		expect(await res.text()).toContain('"type":"error"');
		expect(gatewayRequestIds).toHaveLength(2);
		expect(gatewayRequestIds[0]).not.toBe(gatewayRequestIds[1]);
		expect(info).toHaveBeenCalledWith(
			"Chat support step finished",
			expect.objectContaining({
				gatewayRequestId: gatewayRequestIds[0],
				toolCallCount: 1,
			}),
		);
		expect(warn).toHaveBeenCalledWith(
			"Chat support streaming error",
			expect.objectContaining({
				gatewayRequestId: gatewayRequestIds[1],
				code: "rate_limit_exceeded",
			}),
		);
		expect(
			info.mock.calls.filter(
				([message]) => message === "Chat support request finished",
			),
		).toHaveLength(1);
	});

	it("preserves HTTP status after SDK retries without logging raw payloads", async () => {
		respond = (res) => {
			res.writeHead(429, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: UPSTREAM_MESSAGE } }));
		};
		const warn = vi.spyOn(logger, "warn");
		const res = await requestSupport();
		await res.text();
		expect(warn).toHaveBeenCalledWith(
			"Chat support UI stream error",
			expect.objectContaining({
				statusCode: 429,
				attempts: 3,
				gatewayRequestId: gatewayRequestIds.at(-1),
				outcome: "failed",
			}),
		);
		expect(JSON.stringify(warn.mock.calls)).not.toContain(UPSTREAM_MESSAGE);
	});
});
