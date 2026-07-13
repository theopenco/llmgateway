import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import type * as AiModule from "ai";

// The memory extraction endpoint calls generateText through the gateway;
// stub it so tests are deterministic and offline. Everything else from "ai"
// stays real.
vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof AiModule>();
	return {
		...actual,
		generateText: vi.fn(async () => ({
			toolCalls: [
				{
					toolName: "save_memories",
					input: {
						memories: [
							"Hiring for the Stockholm team",
							"Hiring for the Stockholm team",
							"Prefers concise answers",
						],
					},
				},
			],
		})),
	};
});

async function createProject(
	token: string,
	body: Record<string, unknown> = {},
) {
	const res = await app.request("/chat-projects", {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: token },
		body: JSON.stringify({ name: "Test Project", ...body }),
	});
	expect(res.status).toBe(201);
	const json = await res.json();
	return json.project as { id: string };
}

describe("chat-projects", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("POST / creates a project with defaults", async () => {
		const res = await app.request("/chat-projects", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				name: "Docs Assistant",
				instructions: "Answer from the knowledge base.",
			}),
		});
		expect(res.status).toBe(201);
		const { project } = await res.json();
		expect(project.name).toBe("Docs Assistant");
		expect(project.description).toBe("");
		expect(project.instructions).toBe("Answer from the knowledge base.");
		expect(project.fileCount).toBe(0);
		expect(project.chatCount).toBe(0);
	});

	test("GET / lists only the user's projects", async () => {
		await createProject(token, { name: "Mine" });

		await db.insert(tables.user).values({
			id: "other-user-id",
			name: "Other",
			email: "other@example.com",
			emailVerified: true,
		});
		await db.insert(tables.chatProject).values({
			name: "Not Mine",
			userId: "other-user-id",
		});

		const res = await app.request("/chat-projects", {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);
		const { projects } = await res.json();
		expect(projects).toHaveLength(1);
		expect(projects[0].name).toBe("Mine");
	});

	test("GET /{id} returns 403 for another user's project", async () => {
		await db.insert(tables.user).values({
			id: "other-user-id",
			name: "Other",
			email: "other@example.com",
			emailVerified: true,
		});
		const [other] = await db
			.insert(tables.chatProject)
			.values({ name: "Not Mine", userId: "other-user-id" })
			.returning();

		const res = await app.request(`/chat-projects/${other.id}`, {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(403);
	});

	test("PATCH /{id} updates fields", async () => {
		const project = await createProject(token);
		const res = await app.request(`/chat-projects/${project.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ instructions: "Be terse." }),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.project.instructions).toBe("Be terse.");
		expect(json.project.name).toBe("Test Project");
	});

	test("DELETE /{id} removes the project", async () => {
		const project = await createProject(token);
		const res = await app.request(`/chat-projects/${project.id}`, {
			method: "DELETE",
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);

		const gone = await app.request(`/chat-projects/${project.id}`, {
			headers: { Cookie: token },
		});
		expect(gone.status).toBe(404);
	});

	test("POST /{id}/files rejects files without extractable text", async () => {
		const project = await createProject(token);
		const res = await app.request(`/chat-projects/${project.id}/files`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				name: "empty.txt",
				mimeType: "text/plain",
				content: "   ",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /{id}/retrieve returns empty chunks without calling the gateway", async () => {
		const project = await createProject(token, {
			instructions: "Ground answers in the files.",
		});
		const res = await app.request(`/chat-projects/${project.id}/retrieve`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ query: "anything" }),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.chunks).toEqual([]);
		expect(json.project.instructions).toBe("Ground answers in the files.");
	});

	test("memories support create, list, update, and delete", async () => {
		const project = await createProject(token);

		const created = await app.request(`/chat-projects/${project.id}/memories`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ content: "Prefers concise answers" }),
		});
		expect(created.status).toBe(201);
		const { memory } = await created.json();
		expect(memory.content).toBe("Prefers concise answers");
		expect(memory.source).toBe("manual");

		const updated = await app.request(
			`/chat-projects/${project.id}/memories/${memory.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({ content: "Prefers detailed answers" }),
			},
		);
		expect(updated.status).toBe(200);

		const list = await app.request(`/chat-projects/${project.id}/memories`, {
			headers: { Cookie: token },
		});
		const { memories } = await list.json();
		expect(memories).toHaveLength(1);
		expect(memories[0].content).toBe("Prefers detailed answers");

		const deleted = await app.request(
			`/chat-projects/${project.id}/memories/${memory.id}`,
			{ method: "DELETE", headers: { Cookie: token } },
		);
		expect(deleted.status).toBe(200);

		const empty = await app.request(`/chat-projects/${project.id}/memories`, {
			headers: { Cookie: token },
		});
		expect((await empty.json()).memories).toHaveLength(0);
	});

	test("POST /{id}/retrieve includes project memories", async () => {
		const project = await createProject(token);
		await app.request(`/chat-projects/${project.id}/memories`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ content: "Ismail is based in Lund, Sweden" }),
		});

		const res = await app.request(`/chat-projects/${project.id}/retrieve`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ query: "anything" }),
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.memories).toEqual(["Ismail is based in Lund, Sweden"]);
	});

	test("POST /{id}/memories/extract saves deduped memories from the exchange", async () => {
		const project = await createProject(token);
		// Already-saved memory matching one of the extractor's outputs.
		await app.request(`/chat-projects/${project.id}/memories`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ content: "Prefers concise answers" }),
		});

		const res = await app.request(
			`/chat-projects/${project.id}/memories/extract`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({
					userMessage: "We're hiring for Stockholm. Keep answers short.",
					assistantMessage: "Noted — short answers about the Stockholm role.",
				}),
			},
		);
		expect(res.status).toBe(200);
		const { memories } = await res.json();
		// The mocked extractor returns a duplicated batch entry plus one that
		// already exists; only the single new fact survives.
		expect(memories).toHaveLength(1);
		expect(memories[0].content).toBe("Hiring for the Stockholm team");
		expect(memories[0].source).toBe("auto");

		const list = await app.request(`/chat-projects/${project.id}/memories`, {
			headers: { Cookie: token },
		});
		expect((await list.json()).memories).toHaveLength(2);
	});

	test("POST /{id}/memories/extract short-circuits at the memory cap", async () => {
		const project = await createProject(token);
		await db.insert(tables.chatProjectMemory).values(
			Array.from({ length: 50 }, (_, i) => ({
				projectId: project.id,
				content: `Existing fact ${i}`,
				source: "manual" as const,
			})),
		);

		const { generateText } = await import("ai");
		const callsBefore = vi.mocked(generateText).mock.calls.length;

		const res = await app.request(
			`/chat-projects/${project.id}/memories/extract`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({
					userMessage: "anything",
					assistantMessage: "anything at all",
				}),
			},
		);
		expect(res.status).toBe(200);
		expect((await res.json()).memories).toEqual([]);
		// The cap check returns before any model call.
		expect(vi.mocked(generateText).mock.calls.length).toBe(callsBefore);
	});

	test("POST /{id}/files rejects invalid binary uploads", async () => {
		const project = await createProject(token);
		const res = await app.request(`/chat-projects/${project.id}/files`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				name: "broken.pdf",
				mimeType: "application/pdf",
				contentBase64: Buffer.from("not a pdf").toString("base64"),
			}),
		});
		expect(res.status).toBe(400);
	});

	test("POST /chats accepts a valid projectId and rejects an invalid one", async () => {
		const project = await createProject(token);

		const invalid = await app.request("/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				title: "Bad",
				model: "gpt-5-mini",
				projectId: "does-not-exist",
			}),
		});
		expect(invalid.status).toBe(400);

		const valid = await app.request("/chats", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({
				title: "Good",
				model: "gpt-5-mini",
				projectId: project.id,
			}),
		});
		expect(valid.status).toBe(201);
		const { chat } = await valid.json();
		expect(chat.projectId).toBe(project.id);

		const list = await app.request(`/chats?projectId=${project.id}`, {
			headers: { Cookie: token },
		});
		expect(list.status).toBe(200);
		const { chats } = await list.json();
		expect(chats).toHaveLength(1);
		expect(chats[0].id).toBe(chat.id);
	});
});
