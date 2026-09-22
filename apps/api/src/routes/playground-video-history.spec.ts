import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db } from "@llmgateway/db";

describe("playground video history", () => {
	let authCookie: string;

	const request = (method: string, path = "", body?: unknown) =>
		app.request(`/playground/video-history${path}`, {
			method,
			headers: { "Content-Type": "application/json", Cookie: authCookie },
			...(body !== undefined && { body: JSON.stringify(body) }),
		});

	const pendingModel = {
		modelId: "veo-3.1-generate-preview",
		modelName: "Veo 3.1",
		jobId: "video_123",
		videoUrl: null,
		expiresAt: null,
	};
	const finishedModel = {
		...pendingModel,
		videoUrl: "/api/video/video_123/content",
		expiresAt: 1_800_000_000,
	};

	const savePending = async () => {
		const res = await request("POST", "", {
			prompt: "A slow pan over a harbour",
			models: [pendingModel],
		});
		expect(res.status).toBe(201);
		const json = await res.json();
		return json.item.id as string;
	};

	const listItems = async () => {
		const res = await request("GET");
		expect(res.status).toBe(200);
		return (await res.json()).items;
	};

	const pointEvents = () =>
		db.query.loungePointEvent.findMany({
			where: { userId: { eq: "test-user-id" } },
		});

	beforeEach(async () => {
		authCookie = await createTestUser();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("saves a pending item at submission without awarding points", async () => {
		const id = await savePending();
		const items = await listItems();
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id,
			models: [{ jobId: "video_123", videoUrl: null }],
		});
		expect(await pointEvents()).toHaveLength(0);
	});

	test("records finished results and awards points once", async () => {
		const id = await savePending();

		const res = await request("PATCH", `/${id}`, { models: [finishedModel] });
		expect(res.status).toBe(200);
		expect((await listItems())[0].models).toEqual([finishedModel]);
		expect(await pointEvents()).toHaveLength(1);

		const again = await request("PATCH", `/${id}`, { models: [finishedModel] });
		expect(again.status).toBe(200);
		expect(await pointEvents()).toHaveLength(1);
	});

	test("renames without touching model results", async () => {
		const id = await savePending();
		const res = await request("PATCH", `/${id}`, { prompt: "Harbour pan" });
		expect(res.status).toBe(200);
		expect((await listItems())[0]).toMatchObject({
			prompt: "Harbour pan",
			models: [pendingModel],
		});
	});

	test("rejects an update that changes nothing", async () => {
		const id = await savePending();
		const res = await request("PATCH", `/${id}`, {});
		expect(res.status).toBe(400);
	});

	test("does not update items the user does not own", async () => {
		const res = await request("PATCH", "/someone-elses-item", {
			models: [finishedModel],
		});
		expect(res.status).toBe(404);
	});
});
