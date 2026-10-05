import { createServer, type Server, type ServerResponse } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";

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
			error: { message: UPSTREAM_MESSAGE, type: "upstream_error" },
		})}\n\n`,
	);
}

describe("public chat support stream errors", () => {
	let server: Server;

	beforeAll(async () => {
		server = createServer((_req, res) => streamError(res));
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

		consoleError.mockRestore();
		loggerError.mockRestore();
		loggerWarn.mockRestore();
	});
});
