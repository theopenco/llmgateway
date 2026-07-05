import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

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
