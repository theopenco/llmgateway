import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

const PNG =
	"iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAcklEQVR4nO3P0QkAIRBDwe2/suvKq0FQYmCW96tk5pupLr8AoLz8AoDy8gsAyssvACgvvwCgvO0H6/IBAAAAAHQCdv85FQAAAAAAAAAAAABAHnDqAAAAAADeBrxWfgFAefkFAOXlFwCUl18AUF5+AUB5P4LIBY/1fqM1AAAAAElFTkSuQmCC";

interface Usage {
	prompt_tokens_details?: { image_tokens?: number };
}

describe("image input token usage", () => {
	createGatewayApiTestHarness();
	let server: Server;
	let baseUrl = "";

	beforeAll(async () => {
		server = createServer((req, res) => {
			req.resume();
			req.on("end", () => {
				const payload = {
					candidates: [
						{
							content: { role: "model", parts: [{ text: "Red" }] },
							finishReason: "STOP",
						},
					],
					usageMetadata: {
						promptTokenCount: 264,
						candidatesTokenCount: 1,
						totalTokenCount: 265,
						promptTokensDetails: [
							{ modality: "TEXT", tokenCount: 6 },
							{ modality: "IMAGE", tokenCount: 258 },
						],
					},
				};
				if (req.url?.includes("streamGenerateContent")) {
					res.writeHead(200, { "Content-Type": "text/event-stream" });
					res.end(`data: ${JSON.stringify(payload)}\n\n`);
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify(payload));
			});
		});
		await new Promise<void>((resolve) => {
			server.listen(0, resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Missing mock server port");
		}
		baseUrl = `http://localhost:${address.port}`;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
		});
	});

	test.each([false, true])(
		"reports Gemini text-model image tokens (stream=%s)",
		async (stream) => {
			await db.insert(tables.apiKey).values({
				id: "test-key",
				...hashApiKeyForStorage("test-token"),
				projectId: "project-id",
				createdBy: "user-id",
				description: "Image tokens",
			});
			await db.insert(tables.providerKey).values({
				id: "google-test-key",
				...encryptProviderKeyForStorage(
					"test-provider-key",
					"google-test-key",
					"org-id",
				),
				provider: "google-ai-studio",
				organizationId: "org-id",
				baseUrl,
			});

			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: "Bearer test-token",
					"x-no-fallback": "true",
					"x-no-cache": "true",
				},
				body: JSON.stringify({
					model: "google-ai-studio/gemini-3-flash-preview",
					stream,
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: "What colour is this?" },
								{
									type: "image_url",
									image_url: { url: `data:image/png;base64,${PNG}` },
								},
							],
						},
					],
				}),
			});
			const body = await res.text();
			expect(res.status, body).toBe(200);

			const usage: Usage | undefined = stream
				? body
						.split("\n")
						.filter((line) => line.startsWith("data: {"))
						.map((line) => JSON.parse(line.slice(6)) as { usage?: Usage })
						.filter((chunk) => chunk.usage)
						.at(-1)?.usage
				: (JSON.parse(body) as { usage: Usage }).usage;
			expect(usage?.prompt_tokens_details?.image_tokens).toBe(258);
		},
	);
});
