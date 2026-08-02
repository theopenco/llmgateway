import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const usage = {
	responses: 2,
	inputTokens: 100,
	outputTokens: 40,
	totalTokens: 140,
	audioInputTokens: 60,
	audioOutputTokens: 30,
};

function turn(text: string, role: "user" | "assistant" = "user") {
	return { role, text, status: "final" as const, timestamp: 1_700_000_000_000 };
}

async function createCall(token: string, body: Record<string, unknown> = {}) {
	const res = await app.request("/playground/realtime-history", {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: token },
		body: JSON.stringify({
			title: "Test call",
			model: "openai/gpt-realtime",
			durationSeconds: 30,
			transcript: [turn("hello"), turn("hi there", "assistant")],
			usage,
			...body,
		}),
	});
	expect(res.status).toBe(201);
	const json = await res.json();
	return json.item as { id: string; turnCount: number };
}

async function patchCall(
	token: string,
	id: string,
	body: Record<string, unknown>,
) {
	return await app.request(`/playground/realtime-history/${id}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json", Cookie: token },
		body: JSON.stringify(body),
	});
}

describe("playground realtime history", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("round-trips assistant audio on a transcript entry", async () => {
		const audio = { base64: "UklGRgAAAABXQVZF", mediaType: "audio/wav" };
		const item = await createCall(token, {
			transcript: [turn("hello"), { ...turn("hi", "assistant"), audio }],
		});

		const res = await app.request(`/playground/realtime-history/${item.id}`, {
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.item.transcript[0].audio).toBeUndefined();
		expect(json.item.transcript[1].audio).toEqual(audio);
	});

	test("PATCH renames without touching the transcript", async () => {
		const item = await createCall(token);

		const res = await patchCall(token, item.id, { title: "Renamed" });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.item.title).toBe("Renamed");
		expect(json.item.turnCount).toBe(2);
		expect(json.item.durationSeconds).toBe(30);
	});

	test("PATCH appends turns and sums duration and usage", async () => {
		const item = await createCall(token);

		const res = await patchCall(token, item.id, {
			appendTranscript: [turn("and again"), turn("sure", "assistant")],
			addDurationSeconds: 12,
			addUsage: usage,
		});
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.item.turnCount).toBe(4);
		expect(json.item.durationSeconds).toBe(42);

		const row = await db.query.playgroundRealtimeHistory.findFirst({
			where: { id: { eq: item.id } },
		});
		expect(row?.transcript.map((entry) => entry.text)).toEqual([
			"hello",
			"hi there",
			"and again",
			"sure",
		]);
		expect(row?.usage).toEqual({
			responses: 4,
			inputTokens: 200,
			outputTokens: 80,
			totalTokens: 280,
			audioInputTokens: 120,
			audioOutputTokens: 60,
		});
	});

	test("PATCH sums usage onto a call that had none", async () => {
		const item = await createCall(token, { usage: undefined });

		const res = await patchCall(token, item.id, { addUsage: usage });
		expect(res.status).toBe(200);

		const row = await db.query.playgroundRealtimeHistory.findFirst({
			where: { id: { eq: item.id } },
		});
		expect(row?.usage).toEqual(usage);
	});

	// A no-op body would otherwise reach Drizzle as an empty .set(), which throws.
	test("PATCH rejects an empty body", async () => {
		const item = await createCall(token);
		const res = await patchCall(token, item.id, {});
		expect(res.status).toBe(400);
	});

	test("PATCH 404s on a call the user does not own", async () => {
		const missing = await patchCall(token, "does-not-exist", { title: "Nope" });
		expect(missing.status).toBe(404);

		// Another user's existing call must look identical to a missing one.
		await db.insert(tables.user).values({
			id: "other-user-id",
			name: "Other User",
			email: "other@example.com",
			emailVerified: true,
		});
		const [theirs] = await db
			.insert(tables.playgroundRealtimeHistory)
			.values({
				userId: "other-user-id",
				title: "Their call",
				model: "openai/gpt-realtime",
				transcript: [turn("their message")],
			})
			.returning({ id: tables.playgroundRealtimeHistory.id });

		const res = await patchCall(token, theirs.id, { title: "Nope" });
		expect(res.status).toBe(404);

		const row = await db.query.playgroundRealtimeHistory.findFirst({
			where: { id: { eq: theirs.id } },
		});
		expect(row?.title).toBe("Their call");
	});
});
