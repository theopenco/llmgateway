import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";

type Block = Record<string, unknown> & { type: string };

const PDF_BASE64 = Buffer.from("%PDF-1.4 mock").toString("base64");
const NOTES = "PINEAPPLE";

describe("document input on Anthropic", () => {
	createGatewayApiTestHarness();

	let server: Server;
	let baseUrl = "";
	let captured: Array<{ messages: Array<{ role: string; content: Block[] }> }> =
		[];

	beforeAll(async () => {
		server = createServer((req, res) => {
			let body = "";
			req.on("data", (chunk) => (body += chunk));
			req.on("end", () => {
				captured.push(JSON.parse(body));
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "msg_mock",
						type: "message",
						role: "assistant",
						model: "claude-opus-4-6",
						content: [{ type: "text", text: "Done." }],
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
		await db.insert(tables.apiKey).values({
			id: "document-key",
			...hashApiKeyForStorage("document-token"),
			projectId: "project-id",
			description: "Documents",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "anthropic-document-key",
			...encryptProviderKeyForStorage(
				"mock-provider-key",
				"anthropic-document-key",
				"org-id",
			),
			provider: "anthropic",
			organizationId: "org-id",
			baseUrl,
		});
	}

	function post(path: string, body: Record<string, unknown>) {
		return app.request(path, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer document-token",
				"x-no-fallback": "true",
				"x-no-cache": "true",
			},
			body: JSON.stringify({
				model: "anthropic/claude-opus-4-6",
				max_tokens: 1024,
				...body,
			}),
		});
	}

	function upstreamDocuments() {
		return captured
			.at(-1)!
			.messages.flatMap((message) => message.content)
			.filter((block) => block.type === "document");
	}

	const pdfDocument = {
		type: "document",
		source: { type: "base64", media_type: "application/pdf", data: PDF_BASE64 },
		title: "report.pdf",
	};
	const textDocument = {
		type: "document",
		source: { type: "text", media_type: "text/plain", data: NOTES },
	};

	test("chat completions forwards file parts as document blocks", async () => {
		await setup();

		const res = await post("/v1/chat/completions", {
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "Summarize." },
						{
							type: "file",
							file: {
								filename: "report.pdf",
								file_data: `data:application/pdf;base64,${PDF_BASE64}`,
							},
						},
						{
							type: "file",
							file: {
								file_data: `data:text/markdown;base64,${Buffer.from(NOTES).toString("base64")}`,
							},
						},
					],
				},
			],
		});

		expect(res.status).toBe(200);
		expect(upstreamDocuments()).toEqual([pdfDocument, textDocument]);
	});

	test("chat completions rejects a document type Anthropic cannot read", async () => {
		await setup();

		const res = await post("/v1/chat/completions", {
			messages: [
				{
					role: "user",
					content: [
						{
							type: "file",
							file: { file_data: "data:application/zip;base64,UEsDBA==" },
						},
					],
				},
			],
		});

		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	test("/v1/messages rejects an empty document", async () => {
		await setup();

		const res = await post("/v1/messages", {
			messages: [
				{
					role: "user",
					content: [
						{
							type: "document",
							source: { type: "text", media_type: "text/plain", data: "" },
						},
						{ type: "text", text: "Summarize." },
					],
				},
			],
		});

		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});

	test("/v1/messages forwards document blocks", async () => {
		await setup();

		const res = await post("/v1/messages", {
			messages: [
				{
					role: "user",
					content: [
						pdfDocument,
						textDocument,
						{ type: "text", text: "Summarize." },
					],
				},
			],
		});

		expect(res.status).toBe(200);
		expect(upstreamDocuments()).toEqual([pdfDocument, textDocument]);
	});

	test("/v1/messages keeps a document sent next to a tool result", async () => {
		await setup();

		const res = await post("/v1/messages", {
			messages: [
				{ role: "user", content: "Fetch the report." },
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_0", name: "fetch", input: {} },
					],
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_0", content: "ok" },
						pdfDocument,
						{ type: "text", text: "Summarize." },
					],
				},
			],
		});

		expect(res.status).toBe(200);
		expect(upstreamDocuments()).toEqual([pdfDocument]);
	});

	test("/v1/messages rejects a document the gateway cannot inline", async () => {
		await setup();

		const res = await post("/v1/messages", {
			messages: [
				{
					role: "user",
					content: [
						{
							type: "document",
							source: { type: "url", url: "https://example.com/a.pdf" },
						},
						{ type: "text", text: "Summarize." },
					],
				},
			],
		});

		expect(res.status).toBe(400);
		expect(captured).toHaveLength(0);
	});
});
