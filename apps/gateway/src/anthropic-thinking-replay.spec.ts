import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

type Block = Record<string, unknown> & { type: string };

interface AnthropicMessage {
	role: string;
	content: Block[];
}

const THINKING = "Plan the lookup.";
const SIGNATURE = "upstream-signature";
const REDACTED = "upstream-redacted-payload";

const upstreamBlocks: Block[] = [
	{ type: "thinking", thinking: THINKING, signature: SIGNATURE },
	{ type: "redacted_thinking", data: REDACTED },
	{ type: "text", text: "Done." },
];

// With interleaved thinking, a second thinking block can follow text.
const interleavedBlocks: Block[] = [
	{ type: "thinking", thinking: THINKING, signature: SIGNATURE },
	{ type: "text", text: "First." },
	{ type: "thinking", thinking: "Then finish.", signature: "second-signature" },
	{ type: "text", text: "Done." },
];

function streamEvents(blocks: Block[]): Array<Record<string, unknown>> {
	return [
		{
			type: "message_start",
			message: {
				id: "msg_mock",
				model: "claude-opus-4-6",
				usage: { input_tokens: 9, output_tokens: 1 },
			},
		},
		...blocks.flatMap((block, index) => {
			if (block.type === "redacted_thinking") {
				return [
					{ type: "content_block_start", index, content_block: block },
					{ type: "content_block_stop", index },
				];
			}
			const deltas =
				block.type === "thinking"
					? [
							{ type: "thinking_delta", thinking: block.thinking },
							{ type: "signature_delta", signature: block.signature },
						]
					: [{ type: "text_delta", text: block.text }];
			return [
				{
					type: "content_block_start",
					index,
					content_block:
						block.type === "thinking"
							? { type: "thinking", thinking: "" }
							: { type: "text", text: "" },
				},
				...deltas.map((delta) => ({
					type: "content_block_delta",
					index,
					delta,
				})),
				{ type: "content_block_stop", index },
			];
		}),
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: { output_tokens: 4 },
		},
		{ type: "message_stop" },
	];
}

// Rebuilds the assistant content the way the Anthropic SDK accumulates a
// stream, which is what Claude Code replays on its next request.
function accumulate(sse: string): Block[] {
	const blocks: Block[] = [];
	for (const line of sse.split("\n")) {
		if (!line.startsWith("data: ")) {
			continue;
		}
		const event = JSON.parse(line.slice(6)) as {
			type: string;
			index: number;
			content_block?: Block;
			delta?: Record<string, string>;
		};
		if (event.type === "content_block_start" && event.content_block) {
			blocks[event.index] = { ...event.content_block };
		}
		if (event.type === "content_block_delta" && event.delta) {
			const block = blocks[event.index]!;
			const { type, ...fields } = event.delta;
			const key =
				type === "thinking_delta"
					? "thinking"
					: type === "signature_delta"
						? "signature"
						: type === "text_delta"
							? "text"
							: "partial_json";
			block[key] =
				`${(block[key] as string | undefined) ?? ""}${Object.values(fields)[0]}`;
		}
	}
	return blocks;
}

describe("/v1/messages thinking replay", () => {
	createGatewayApiTestHarness();

	let server: Server;
	let baseUrl = "";
	let captured: Array<{ messages: AnthropicMessage[] }> = [];
	let responseBlocks = upstreamBlocks;

	beforeAll(async () => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				const parsed = JSON.parse(body) as {
					stream?: boolean;
					messages: AnthropicMessage[];
				};
				captured.push(parsed);
				if (parsed.stream) {
					res.writeHead(200, { "content-type": "text/event-stream" });
					for (const event of streamEvents(responseBlocks)) {
						res.write(
							`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
						);
					}
					res.end();
					return;
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "msg_mock",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-6",
						content: responseBlocks,
						stop_reason: "end_turn",
						usage: { input_tokens: 9, output_tokens: 4 },
					}),
				);
			});
		});
		baseUrl = await new Promise<string>((resolve) => {
			server.listen(0, () => {
				const address = server.address();
				resolve(
					`http://localhost:${typeof address === "object" && address ? address.port : 0}`,
				);
			});
		});
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	});

	async function setup() {
		captured = [];
		responseBlocks = upstreamBlocks;
		await db.insert(tables.apiKey).values({
			id: "thinking-replay-key",
			...hashApiKeyForStorage("thinking-replay-token"),
			projectId: "project-id",
			description: "Thinking replay",
			createdBy: "user-id",
		});
		for (const provider of ["anthropic", "azure-anthropic"]) {
			await db.insert(tables.providerKey).values({
				id: `${provider}-thinking-key`,
				...encryptProviderKeyForStorage(
					"mock-provider-key",
					`${provider}-thinking-key`,
					"org-id",
				),
				provider,
				organizationId: "org-id",
				baseUrl,
			});
		}
	}

	async function send(
		model: string,
		messages: Array<{ role: string; content: string | Block[] }>,
		stream: boolean,
	): Promise<Block[]> {
		const res = await app.request("/v1/messages", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer thinking-replay-token",
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify({ model, max_tokens: 1024, stream, messages }),
		});
		expect(res.status).toBe(200);
		if (stream) {
			return accumulate(await res.text());
		}
		return ((await res.json()) as { content: Block[] }).content;
	}

	function upstreamAssistant(request: number): Block[] {
		const assistant = captured[request]!.messages.find(
			(message) => message.role === "assistant",
		);
		return assistant!.content;
	}

	for (const stream of [false, true]) {
		const label = stream ? "streamed" : "non-streamed";

		test(`replays ${label} thinking blocks to the provider that signed them`, async () => {
			await setup();
			const prompt = { role: "user", content: "Look it up." };
			const content = await send("anthropic/claude-opus-4-6", [prompt], stream);

			await send(
				"anthropic/claude-opus-4-6",
				[
					prompt,
					{ role: "assistant", content },
					{ role: "user", content: "Thanks." },
				],
				stream,
			);

			expect(upstreamAssistant(1).slice(0, 2)).toEqual(
				upstreamBlocks.slice(0, 2),
			);
		});

		test(`drops ${label} thinking blocks signed by another provider`, async () => {
			await setup();
			const prompt = { role: "user", content: "Look it up." };
			const content = await send(
				"azure-anthropic/claude-opus-4-6",
				[prompt],
				stream,
			);

			await send(
				"anthropic/claude-opus-4-6",
				[
					prompt,
					{ role: "assistant", content },
					{ role: "user", content: "Thanks." },
				],
				stream,
			);

			expect(upstreamAssistant(1).map((block) => block.type)).toEqual(["text"]);
		});

		test(`drops ${label} thinking that does not open the turn`, async () => {
			await setup();
			responseBlocks = interleavedBlocks;
			const prompt = { role: "user", content: "Look it up." };
			const content = await send("anthropic/claude-opus-4-6", [prompt], stream);

			// Replay puts thinking first, which would modify this turn's order.
			await send(
				"anthropic/claude-opus-4-6",
				[
					prompt,
					{ role: "assistant", content },
					{ role: "user", content: "Thanks." },
				],
				stream,
			);

			expect(
				upstreamAssistant(1).filter((block) => block.type === "thinking"),
			).toEqual([]);
		});
	}

	test("drops thinking blocks the gateway did not issue", async () => {
		await setup();
		await send(
			"anthropic/claude-opus-4-6",
			[
				{ role: "user", content: "Look it up." },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: THINKING, signature: "" },
						{ type: "thinking", thinking: THINKING, signature: SIGNATURE },
						{ type: "redacted_thinking", data: REDACTED },
						{ type: "text", text: "Done." },
					],
				},
				{ role: "user", content: "Thanks." },
			],
			false,
		);

		expect(upstreamAssistant(0).map((block) => block.type)).toEqual(["text"]);
	});
});
