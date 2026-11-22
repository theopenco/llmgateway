import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import {
	ASSISTANT_KEY_DESCRIPTION,
	ASSISTANT_SOURCE,
} from "@llmgateway/shared/dashboard-assistant";

import type { MockInstance } from "vitest";

const organizationId = "assistant-org";
const projectId = "assistant-project";

function toolCallResponse() {
	const frames = [
		{
			tool_calls: [
				{
					index: 0,
					id: "fixture-call",
					type: "function",
					function: { name: "open_page", arguments: '{"page":"api-keys"}' },
				},
			],
		},
		{},
	].map((delta, index) => ({
		id: "chatcmpl-fixture",
		object: "chat.completion.chunk",
		created: 1,
		model: "fixture",
		choices: [
			{ index: 0, delta, finish_reason: index === 1 ? "tool_calls" : null },
		],
	}));
	return new Response(
		frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
			"data: [DONE]\n\n",
		{ headers: { "Content-Type": "text/event-stream" } },
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

describe("dashboard assistant", () => {
	let cookie: string;
	let upstream: MockInstance<typeof fetch>;

	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: organizationId,
			name: "Assistant Org",
			billingEmail: "admin@example.com",
			credits: "5",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: projectId,
			name: "Assistant Project",
			organizationId,
			mode: "credits",
		});
		upstream = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () => toolCallResponse());
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await deleteAll();
	});

	function chat(
		extra: Record<string, unknown> = {},
		headers: Record<string, string> = { Cookie: cookie },
	) {
		return app.request("/assistant/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({
				organizationId,
				projectId,
				messages: [
					{
						id: "fixture-message",
						role: "user",
						parts: [{ type: "text", text: "Where are my API keys?" }],
					},
				],
				tools: [
					{
						name: "open_page",
						description: "Open a dashboard page",
						inputSchema: {
							type: "object",
							properties: { page: { type: "string" } },
						},
					},
				],
				...extra,
			}),
		});
	}

	function transcribe(headers: Record<string, string> = { Cookie: cookie }) {
		return app.request("/assistant/transcribe", {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({
				organizationId,
				projectId,
				audio: Buffer.from("fixture-audio").toString("base64"),
				mimeType: "audio/webm;codecs=opus",
			}),
		});
	}

	it("requires a session", async () => {
		expect((await chat({}, {})).status).toBe(401);
		expect((await transcribe({})).status).toBe(401);
		expect(upstream).not.toHaveBeenCalled();
	});

	it("hides projects the member cannot reach", async () => {
		await db.insert(tables.organization).values({
			id: "other-org",
			name: "Other Org",
			billingEmail: "other@example.com",
			credits: "5",
		});
		await db.insert(tables.project).values({
			id: "other-project",
			name: "Other Project",
			organizationId: "other-org",
			mode: "credits",
		});
		expect(
			(await chat({ organizationId: "other-org", projectId: "other-project" }))
				.status,
		).toBe(404);
		// A reachable organization cannot be billed for another one's project.
		expect((await chat({ projectId: "other-project" })).status).toBe(404);
		expect(upstream).not.toHaveBeenCalled();
		expect(await db.$count(tables.apiKey)).toBe(0);
	});

	it("needs credits before any model call", async () => {
		await db
			.update(tables.organization)
			.set({ credits: "0" })
			.where(eq(tables.organization.id, organizationId));
		expect((await chat()).status).toBe(402);
		expect((await transcribe()).status).toBe(402);
		expect(upstream).not.toHaveBeenCalled();
	});

	it.each([
		{ tools: [{ name: "bad name", description: "x" }] },
		{ messages: [] },
		{
			messages: [
				{
					id: "pending",
					role: "assistant",
					parts: [
						{
							type: "dynamic-tool",
							toolName: "open_page",
							toolCallId: "pending-call",
							state: "input-available",
							input: {},
						},
					],
				},
			],
		},
		{ unknown: true },
	])("rejects invalid requests: %j", async (body) => {
		expect((await chat(body)).status).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});

	it("streams the page's tool call for the browser to run", async () => {
		const response = await chat();
		expect(response.status).toBe(200);
		expect(events(await response.text())).toContainEqual(
			expect.objectContaining({
				type: "tool-input-available",
				toolName: "open_page",
				input: { page: "api-keys" },
				dynamic: true,
			}),
		);

		const [url, init] = upstream.mock.calls[0];
		expect(String(url)).toContain("/v1/chat/completions");
		const headers = new Headers(init?.headers);
		expect(headers.get("x-source")).toBe(ASSISTANT_SOURCE);
		const sent = z
			.object({
				tools: z.array(z.object({ function: z.object({ name: z.string() }) })),
			})
			.parse(JSON.parse(String(init?.body)));
		expect(sent.tools.map((tool) => tool.function.name)).toEqual(["open_page"]);

		// Billed through a managed key in the caller's own project.
		const keys = await db.query.apiKey.findMany();
		expect(keys).toHaveLength(1);
		expect(keys[0]).toMatchObject({
			projectId,
			kind: "playground",
			description: ASSISTANT_KEY_DESCRIPTION,
			createdBy: "test-user-id",
		});
		expect(response.headers.get("set-cookie")).toContain(
			"llmgateway_assistant_key=",
		);
	});

	it("reuses its key and leaves the member's Lounge key alone", async () => {
		const first = await chat();
		const assistantCookie = (first.headers.get("set-cookie") ?? "").split(
			";",
		)[0];
		await first.text();
		const loungeKey = hashApiKeyForStorage(["lounge", "fixture"].join("-"));
		await db.insert(tables.apiKey).values({
			id: "lounge-key",
			...loungeKey,
			projectId,
			description: "Lounge",
			kind: "playground",
			createdBy: "test-user-id",
		});
		const second = await chat({}, { Cookie: `${cookie}; ${assistantCookie}` });
		await second.text();
		expect(second.headers.get("set-cookie") ?? "").not.toContain(
			"llmgateway_assistant_key=",
		);
		const keys = await db.query.apiKey.findMany();
		expect(keys).toHaveLength(2);
		expect(keys.find((key) => key.id === "lounge-key")).toMatchObject({
			description: "Lounge",
			tokenHash: loungeKey.tokenHash,
		});
	});

	it("transcribes a recording through the gateway", async () => {
		upstream.mockImplementation(async () =>
			Response.json({ text: "  where are my api keys  " }),
		);
		const response = await transcribe();
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ text: "where are my api keys" });

		const [url, init] = upstream.mock.calls[0];
		expect(String(url)).toContain("/v1/audio/transcriptions");
		expect(new Headers(init?.headers).get("x-source")).toBe(ASSISTANT_SOURCE);
		const form = init?.body;
		expect(form).toBeInstanceOf(FormData);
		if (form instanceof FormData) {
			const file = form.get("file");
			expect(file).toBeInstanceOf(Blob);
			expect(file instanceof Blob ? file.type : "").toBe("audio/webm");
		}
	});

	it("reports a failed transcription as a gateway error", async () => {
		upstream.mockImplementation(
			async () => new Response("upstream failed", { status: 500 }),
		);
		expect((await transcribe()).status).toBe(502);
	});
});
