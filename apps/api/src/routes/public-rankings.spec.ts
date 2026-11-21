import { beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { resetLocalPublicResponseCache } from "@/lib/public-response-cache.js";
import { deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { models, type ModelDefinition } from "@llmgateway/models";

const textModels = (models as readonly ModelDefinition[]).filter(
	(model) => !model.output?.some((kind) => kind !== "text"),
);
const MODEL_A = textModels[0].id;
const MODEL_B = textModels[1].id;

const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
	const offsetMs = hours * HOUR_MS;
	return new Date(Math.floor((Date.now() - offsetMs) / HOUR_MS) * HOUR_MS);
}

function dayOf(date: Date): Date {
	const day = new Date(date);
	day.setUTCHours(0, 0, 0, 0);
	return day;
}

async function seedAgent(
	source: string,
	projects: number,
	usage: { usedModel: string; tokens: number }[],
	when = hoursAgo(2),
) {
	const total = usage.reduce((sum, row) => sum + row.tokens, 0) * projects;
	await db.insert(tables.globalSourceStats).values({
		source,
		dayTimestamp: dayOf(when),
		requestCount: 1,
		totalTokens: String(total),
	});
	for (let index = 0; index < projects; index++) {
		const projectId = `${source}-project-${index}`;
		await db.insert(tables.organization).values({
			id: `${source}-org-${index}`,
			name: "Test Organization",
			billingEmail: "admin@example.com",
		});
		await db.insert(tables.project).values({
			id: projectId,
			name: "Test Project",
			organizationId: `${source}-org-${index}`,
		});
		await db.insert(tables.projectHourlySourceModelStats).values(
			usage.map((row) => ({
				projectId,
				hourTimestamp: when,
				source,
				usedModel: row.usedModel,
				usedProvider: row.usedModel.split("/")[0],
				requestCount: 1,
				totalTokens: String(row.tokens),
			})),
		);
	}
}

async function getJson(path: string) {
	const res = await app.request(path);
	expect(res.status).toBe(200);
	return await res.json();
}

describe("public rankings", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.delete(tables.projectHourlySourceModelStats);
		await db.delete(tables.globalSourceStats);
		await db.delete(tables.globalModelStats);
		await redisClient.flushdb();
		resetLocalPublicResponseCache();
	});

	test("reports each app's model shares, merging providers and regions", async () => {
		await seedAgent("agent-one", 5, [
			{ usedModel: `openai/${MODEL_A}`, tokens: 600 },
			{ usedModel: `azure/${MODEL_A}:eu`, tokens: 200 },
			{ usedModel: `openai/${MODEL_B}`, tokens: 150 },
			{ usedModel: "custom/not-in-the-catalogue", tokens: 50 },
		]);

		const body = await getJson("/public/rankings/agents");
		expect(body.window).toBe("7d");
		expect(body.agents).toEqual([
			{
				source: "agent-one",
				models: [
					{ modelId: MODEL_A, sharePercent: 80 },
					{ modelId: MODEL_B, sharePercent: 15 },
				],
				otherSharePercent: 5,
			},
		]);
	});

	test("leaves out apps used by too few organizations, untagged traffic and old traffic", async () => {
		await seedAgent("small-agent", 4, [
			{ usedModel: `openai/${MODEL_A}`, tokens: 1000 },
		]);
		await seedAgent("unknown", 6, [
			{ usedModel: `openai/${MODEL_A}`, tokens: 1000 },
		]);
		await seedAgent(
			"old-agent",
			6,
			[{ usedModel: `openai/${MODEL_A}`, tokens: 1000 }],
			hoursAgo(24 * 9),
		);

		const body = await getJson("/public/rankings/agents");
		expect(body.agents).toEqual([]);
	});

	test("reports blended cost per million tokens per provider", async () => {
		const day = dayOf(hoursAgo(26));
		await db.insert(tables.globalModelStats).values([
			{
				usedModel: `openai/${MODEL_A}`,
				usedProvider: "openai",
				dayTimestamp: day,
				totalTokens: "3000000",
				cost: 6,
			},
			{
				usedModel: `azure/${MODEL_A}:eu`,
				usedProvider: "azure",
				dayTimestamp: day,
				totalTokens: "1000000",
				cost: 4,
			},
			// Under 1% of the model's tokens: too small a sample to publish.
			{
				usedModel: `tiny/${MODEL_A}`,
				usedProvider: "tiny",
				dayTimestamp: day,
				totalTokens: "1000",
				cost: 1,
			},
			{
				usedModel: "custom/not-in-the-catalogue",
				usedProvider: "custom",
				dayTimestamp: day,
				totalTokens: "9000000",
				cost: 1,
			},
		]);

		const body = await getJson("/public/rankings/token-costs?window=30d");
		expect(body.models).toEqual([
			{
				modelId: MODEL_A,
				providers: [
					{ providerId: "openai", costPerMillionTokens: 2, sharePercent: 75 },
					{ providerId: "azure", costPerMillionTokens: 4, sharePercent: 25 },
				],
			},
		]);
	});

	test("rejects an unsupported window", async () => {
		const res = await app.request("/public/rankings/agents?window=1y");
		expect(res.status).toBe(400);
	});
});
