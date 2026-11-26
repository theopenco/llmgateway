import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db } from "@llmgateway/db";

describe("playground decision history", () => {
	let authCookie: string;

	const request = (method: string, path = "", body?: unknown) =>
		app.request(`/playground/decision-history${path}`, {
			method,
			headers: { "Content-Type": "application/json", Cookie: authCookie },
			...(body !== undefined && { body: JSON.stringify(body) }),
		});

	const questions = [
		{
			type: "choice",
			name: "department",
			instructions: "Which team should handle this?",
			choices: [{ value: "billing" }, { value: "technical" }],
		},
		{ type: "predicate", name: "is_urgent", instructions: "Is it urgent?" },
	];

	const answeredModel = {
		modelId: "gpt-6-luna-decisions",
		modelName: "GPT-6 Luna Decisions",
		answers: [
			{
				type: "choice",
				name: "department",
				choice: "billing",
				probabilities: [
					{ value: "billing", probability: 0.9 },
					{ value: "technical", probability: 0.1 },
				],
				confidence: 0.8,
			},
			{ type: "predicate", name: "is_urgent", probability: 0.95 },
		],
		usage: { input_tokens: 120, output_tokens: 0, total_tokens: 120 },
	};
	const failedModel = {
		modelId: "microsoft-decision-1",
		modelName: "Microsoft-Decision-1",
		answers: null,
		error: "upstream failed",
	};

	const save = async (models: unknown[] = [answeredModel]) => {
		const res = await request("POST", "", {
			prompt: "I was charged twice for my order.",
			questions,
			models,
		});
		expect(res.status).toBe(201);
		return (await res.json()).item.id as string;
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

	test("saves a run with its questions and answers and awards points", async () => {
		const id = await save();
		const items = await listItems();
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			id,
			title: null,
			prompt: "I was charged twice for my order.",
			questions,
			models: [answeredModel],
		});
		expect(await pointEvents()).toHaveLength(1);
	});

	test("awards nothing when every model failed", async () => {
		await save([failedModel]);
		expect(await pointEvents()).toHaveLength(0);
	});

	test("rejects a run without questions or with malformed ones", async () => {
		const none = await request("POST", "", {
			prompt: "hello",
			questions: [],
			models: [answeredModel],
		});
		expect(none.status).toBe(400);

		const malformed = await request("POST", "", {
			prompt: "hello",
			questions: [
				{ type: "choice", name: "x", instructions: "x", choices: [] },
			],
			models: [answeredModel],
		});
		expect(malformed.status).toBe(400);
	});

	test("renames set the title and leave the input untouched", async () => {
		const id = await save();
		const res = await request("PATCH", `/${id}`, { title: "Billing triage" });
		expect(res.status).toBe(200);
		expect((await listItems())[0]).toMatchObject({
			title: "Billing triage",
			prompt: "I was charged twice for my order.",
		});
	});

	test("deletes a run", async () => {
		const id = await save();
		const res = await request("DELETE", `/${id}`);
		expect(res.status).toBe(200);
		expect(await listItems()).toHaveLength(0);
	});

	test("rejects an organization the user is not a member of", async () => {
		const res = await request("POST", "", {
			prompt: "hello",
			organizationId: "someone-elses-org",
			questions,
			models: [answeredModel],
		});
		expect(res.status).toBe(403);
	});

	test("accepts an images-only run and serves the payloads on the detail route", async () => {
		const image = {
			dataUrl: "data:image/png;base64,iVBORw0KGgo=",
			mediaType: "image/png",
		};
		const res = await request("POST", "", {
			prompt: "",
			inputImages: [image],
			questions,
			models: [answeredModel],
		});
		expect(res.status).toBe(201);
		const id = (await res.json()).item.id as string;

		const [listed] = await listItems();
		expect(listed).toMatchObject({ id, inputImageCount: 1 });
		expect(listed.inputImages).toBeUndefined();

		const detail = await request("GET", `/${id}`);
		expect(detail.status).toBe(200);
		expect((await detail.json()).item.inputImages).toEqual([image]);
	});

	test("rejects remote image URLs and empty runs", async () => {
		const remote = await request("POST", "", {
			prompt: "",
			inputImages: [
				{ dataUrl: "https://example.com/x.png", mediaType: "image/png" },
			],
			questions,
			models: [answeredModel],
		});
		expect(remote.status).toBe(400);

		const empty = await request("POST", "", {
			prompt: "   ",
			questions,
			models: [answeredModel],
		});
		expect(empty.status).toBe(400);
	});

	test("does not touch items the user does not own", async () => {
		const rename = await request("PATCH", "/someone-elses-item", {
			title: "x",
		});
		expect(rename.status).toBe(404);
		const remove = await request("DELETE", "/someone-elses-item");
		expect(remove.status).toBe(404);
		const detail = await request("GET", "/someone-elses-item");
		expect(detail.status).toBe(404);
	});
});
