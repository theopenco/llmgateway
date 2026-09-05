import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

import type { GoogleTextPart } from "@llmgateway/actions";
import type { ReasoningDetail } from "@llmgateway/models";

interface AssistantMessage {
	role: "assistant";
	content: string;
	reasoning_details: ReasoningDetail[];
}

interface ChatChunk {
	choices: Array<{ delta: Partial<AssistantMessage> }>;
}

function parseEvents(body: string): Array<Record<string, unknown>> {
	return body
		.split("\n")
		.filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
		.map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

describe("Gemini thought signature replay", () => {
	createGatewayApiTestHarness();
	let server: Server;
	let baseUrl = "";
	let captured: Array<{
		contents: Array<{ role: string; parts: GoogleTextPart[] }>;
	}> = [];
	const signature = "test-text-signature";
	const headers = {
		"Content-Type": "application/json",
		Authorization: "Bearer test-token",
		"x-no-fallback": "true",
		"x-no-cache": "true",
	};
	const model = "google-ai-studio/gemini-3.5-flash";

	beforeAll(async () => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk;
			});
			req.on("end", () => {
				captured.push(JSON.parse(body));
				const response = (parts: GoogleTextPart[], final = false) => ({
					candidates: [
						{
							content: { role: "model", parts },
							...(final ? { finishReason: "STOP" } : {}),
						},
					],
					...(final
						? {
								usageMetadata: {
									promptTokenCount: 10,
									candidatesTokenCount: 5,
									totalTokenCount: 15,
								},
							}
						: {}),
				});
				if (req.url?.includes("streamGenerateContent")) {
					res.writeHead(200, { "Content-Type": "text/event-stream" });
					for (const chunk of [
						response([{ text: "Answer: " }]),
						response([{ text: "42" }]),
						response([{ text: "", thoughtSignature: signature }], true),
					]) {
						res.write(`data: ${JSON.stringify(chunk)}\n\n`);
					}
					res.end();
				} else {
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(
						JSON.stringify(
							response(
								[
									{ text: "Answer: " },
									{ text: "42", thoughtSignature: signature },
								],
								true,
							),
						),
					);
				}
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

	async function setup(retention: "retain" | "none") {
		captured = [];
		await db
			.update(tables.organization)
			.set({ retentionLevel: retention })
			.where(eq(tables.organization.id, "org-id"));
		await db.insert(tables.apiKey).values({
			id: "test-key",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Signature replay",
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
	}

	for (const retention of ["retain", "none"] as const) {
		for (const stream of [false, true]) {
			for (const endpoint of ["chat/completions", "responses"]) {
				test(`${endpoint}: replays ${stream ? "streamed" : "non-streamed"} text with retention ${retention}`, async () => {
					await setup(retention);
					const initial = { role: "user", content: "What is the answer?" };
					const isResponses = endpoint === "responses";
					const res = await app.request(`/v1/${endpoint}`, {
						method: "POST",
						headers,
						body: JSON.stringify({
							model,
							stream,
							...(isResponses
								? { input: [initial], store: false }
								: { messages: [initial] }),
						}),
					});
					expect(res.status).toBe(200);
					let replay: unknown[];
					if (isResponses) {
						const response = stream
							? (parseEvents(await res.text()).find(
									(event) => event.type === "response.completed",
								)?.response as { output: Array<Record<string, unknown>> })
							: ((await res.json()) as {
									output: Array<Record<string, unknown>>;
								});
						const message = response.output.find(
							(item) => item.type === "message",
						);
						expect(message?.reasoning_details).toEqual(
							expect.arrayContaining([
								expect.objectContaining({
									format: "google-gemini-v1",
									signature,
								}),
							]),
						);
						replay = response.output;
					} else {
						let message: AssistantMessage;
						if (stream) {
							message = {
								role: "assistant",
								content: "",
								reasoning_details: [],
							};
							for (const event of parseEvents(await res.text())) {
								const delta = (event as unknown as ChatChunk).choices[0]?.delta;
								message.content += delta?.content ?? "";
								message.reasoning_details.push(
									...(delta?.reasoning_details ?? []),
								);
							}
						} else {
							const response = (await res.json()) as {
								choices: Array<{ message: AssistantMessage }>;
							};
							message = response.choices[0]!.message;
						}
						expect(message.reasoning_details).toEqual(
							expect.arrayContaining([
								expect.objectContaining({
									format: "google-gemini-v1",
									signature,
								}),
							]),
						);
						replay = [message];
					}
					const history = [
						initial,
						...replay,
						{ role: "user", content: "Explain further." },
					];
					const next = await app.request(`/v1/${endpoint}`, {
						method: "POST",
						headers,
						body: JSON.stringify({
							model,
							...(isResponses
								? { input: history, store: false }
								: { messages: history }),
						}),
					});
					expect(next.status).toBe(200);
					await next.text();
					expect(captured).toHaveLength(2);
					expect(
						captured[1]!.contents.find((item) => item.role === "model")?.parts,
					).toEqual(
						stream
							? [
									{ text: "Answer: 42" },
									{ text: "", thoughtSignature: signature },
								]
							: [
									{ text: "Answer: " },
									{ text: "42", thoughtSignature: signature },
								],
					);
				});
			}
		}
	}
	test("restores text from stored Responses history", async () => {
		await setup("retain");
		const first = await app.request("/v1/responses", {
			method: "POST",
			headers,
			body: JSON.stringify({ model, input: "What is the answer?" }),
		});
		expect(first.status).toBe(200);
		const response = (await first.json()) as { id: string };
		const next = await app.request("/v1/responses", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				input: "Explain further.",
				previous_response_id: response.id,
			}),
		});
		expect(next.status).toBe(200);
		await next.text();
		expect(
			captured[1]!.contents.find((item) => item.role === "model")?.parts,
		).toEqual([
			{ text: "Answer: " },
			{ text: "42", thoughtSignature: signature },
		]);
	});

	test("preserves explicit text and tool signatures instead of a cached signature", async () => {
		await setup("retain");
		await redisClient.setex(
			"thought_signature:call_test",
			60,
			"cached-test-signature",
		);
		const extra_content = { google: { thought_signature: signature } };
		const response = await app.request("/v1/chat/completions", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model,
				messages: [
					{ role: "user", content: "Look up the answer." },
					{
						role: "assistant",
						content: [{ type: "text", text: "Looking it up.", extra_content }],
						tool_calls: [
							{
								id: "call_test",
								type: "function",
								function: { name: "lookup", arguments: "{}" },
								extra_content,
							},
						],
					},
					{ role: "tool", content: "42", tool_call_id: "call_test" },
				],
				tools: [
					{
						type: "function",
						function: {
							name: "lookup",
							parameters: { type: "object", properties: {} },
						},
					},
				],
			}),
		});
		expect(response.status).toBe(200);
		await response.text();
		expect(
			captured[0]!.contents.find((item) => item.role === "model")?.parts,
		).toEqual([
			{ text: "Looking it up.", thoughtSignature: signature },
			{
				functionCall: { name: "lookup", args: {} },
				thoughtSignature: signature,
			},
		]);
	});
});
