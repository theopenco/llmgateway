import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, inArray, tables } from "@llmgateway/db";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const DAY_MS = 86_400_000;
const MODEL_PREFIX = "admin-regional-mapping-totals";
const BEDROCK_MODEL = `${MODEL_PREFIX}-bedrock`;
const MANTLE_MODEL = `${MODEL_PREFIX}-mantle`;
const MODEL_IDS = [BEDROCK_MODEL, MANTLE_MODEL];
const MAPPING_IDS = [
	`${BEDROCK_MODEL}-root`,
	`${BEDROCK_MODEL}-region`,
	`${MANTLE_MODEL}-root`,
	`${MANTLE_MODEL}-region`,
];

interface CatalogTotals {
	totalRequests?: number;
	totalTokens: number;
	totalCost: number;
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	inputCost: number;
	cachedInputCost: number;
	outputCost: number;
}

async function clearFixtures() {
	await db
		.delete(tables.modelProviderMappingHistoryHourly)
		.where(
			inArray(
				tables.modelProviderMappingHistoryHourly.modelProviderMappingId,
				MAPPING_IDS,
			),
		);
	await db
		.delete(tables.modelHistoryHourly)
		.where(inArray(tables.modelHistoryHourly.modelId, MODEL_IDS));
	await db
		.delete(tables.modelProviderMapping)
		.where(inArray(tables.modelProviderMapping.modelId, MODEL_IDS));
	await db.delete(tables.model).where(inArray(tables.model.id, MODEL_IDS));
}

async function getJson<T>(cookie: string, path: string): Promise<T> {
	const response = await app.request(path, {
		headers: { Cookie: cookie },
	});
	expect(response.status).toBe(200);
	return (await response.json()) as T;
}

describe("admin model-provider mapping totals", () => {
	let cookie: string;
	let fromDate: string;
	let toDate: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();
		await clearFixtures();

		const hour = new Date();
		hour.setUTCHours(12, 0, 0, 0);
		fromDate = hour.toISOString().slice(0, 10);
		toDate = new Date(hour.getTime() + DAY_MS).toISOString().slice(0, 10);

		await db
			.insert(tables.provider)
			.values([
				{ id: "aws-bedrock", name: "AWS Bedrock", description: "test" },
				{ id: "aws-mantle", name: "AWS Mantle", description: "test" },
			])
			.onConflictDoNothing();
		await db.insert(tables.model).values([
			{ id: BEDROCK_MODEL, family: "test" },
			{ id: MANTLE_MODEL, family: "test" },
		]);
		await db.insert(tables.modelProviderMapping).values([
			{
				id: `${BEDROCK_MODEL}-root`,
				modelId: BEDROCK_MODEL,
				providerId: "aws-bedrock",
				externalId: BEDROCK_MODEL,
			},
			{
				id: `${BEDROCK_MODEL}-region`,
				modelId: BEDROCK_MODEL,
				providerId: "aws-bedrock",
				externalId: BEDROCK_MODEL,
				region: "us-east-1",
			},
			{
				id: `${MANTLE_MODEL}-root`,
				modelId: MANTLE_MODEL,
				providerId: "aws-mantle",
				externalId: MANTLE_MODEL,
			},
			{
				id: `${MANTLE_MODEL}-region`,
				modelId: MANTLE_MODEL,
				providerId: "aws-mantle",
				externalId: MANTLE_MODEL,
				region: "us-east-1",
			},
		]);

		const bedrockStats = {
			logsCount: 10,
			totalInputTokens: 60,
			totalCachedTokens: 10,
			totalOutputTokens: 30,
			totalTokens: 100,
			totalInputCost: 0.8,
			totalCachedInputCost: 0.2,
			totalOutputCost: 0.7,
			totalCost: 2,
		};
		const mantleStats = {
			logsCount: 20,
			totalInputTokens: 120,
			totalCachedTokens: 20,
			totalOutputTokens: 60,
			totalTokens: 200,
			totalInputCost: 2,
			totalCachedInputCost: 0.5,
			totalOutputCost: 1.5,
			totalCost: 5,
		};
		await db.insert(tables.modelProviderMappingHistoryHourly).values([
			{
				id: `${BEDROCK_MODEL}-root-hour`,
				modelId: BEDROCK_MODEL,
				providerId: "aws-bedrock",
				modelProviderMappingId: `${BEDROCK_MODEL}-root`,
				hourTimestamp: hour,
				...bedrockStats,
			},
			{
				id: `${BEDROCK_MODEL}-region-hour`,
				modelId: BEDROCK_MODEL,
				providerId: "aws-bedrock",
				modelProviderMappingId: `${BEDROCK_MODEL}-region`,
				hourTimestamp: hour,
				...bedrockStats,
			},
			{
				id: `${MANTLE_MODEL}-root-hour`,
				modelId: MANTLE_MODEL,
				providerId: "aws-mantle",
				modelProviderMappingId: `${MANTLE_MODEL}-root`,
				hourTimestamp: hour,
				...mantleStats,
			},
			{
				id: `${MANTLE_MODEL}-region-hour`,
				modelId: MANTLE_MODEL,
				providerId: "aws-mantle",
				modelProviderMappingId: `${MANTLE_MODEL}-region`,
				hourTimestamp: hour,
				...mantleStats,
			},
		]);
		await db.insert(tables.modelHistoryHourly).values([
			{
				id: `${BEDROCK_MODEL}-hour`,
				modelId: BEDROCK_MODEL,
				hourTimestamp: hour,
				...bedrockStats,
			},
			{
				id: `${MANTLE_MODEL}-hour`,
				modelId: MANTLE_MODEL,
				hourTimestamp: hour,
				...mantleStats,
			},
		]);
	});

	afterEach(async () => {
		await clearFixtures();
		await deleteAll();
		if (originalAdminEmails === undefined) {
			delete process.env.ADMIN_EMAILS;
		} else {
			process.env.ADMIN_EMAILS = originalAdminEmails;
		}
	});

	test("matches canonical and provider totals without regional duplicates", async () => {
		const query = `from=${fromDate}&to=${toDate}`;
		const [mappings, models, providers] = await Promise.all([
			getJson<CatalogTotals>(
				cookie,
				`/admin/model-provider-mappings?search=${MODEL_PREFIX}&${query}`,
			),
			getJson<CatalogTotals>(
				cookie,
				`/admin/models?search=${MODEL_PREFIX}&limit=100&${query}`,
			),
			getJson<CatalogTotals>(cookie, `/admin/providers?${query}`),
		]);

		expect(mappings).toMatchObject({
			totalRequests: 30,
			totalTokens: 300,
			totalCost: 7,
			inputTokens: 180,
			cachedTokens: 30,
			outputTokens: 90,
		});
		expect(mappings.totalCost).toBeCloseTo(models.totalCost, 6);
		expect(mappings.totalCost).toBeCloseTo(providers.totalCost, 6);
		expect(mappings.inputCost).toBeCloseTo(models.inputCost, 6);
		expect(mappings.cachedInputCost).toBeCloseTo(models.cachedInputCost, 6);
		expect(mappings.outputCost).toBeCloseTo(models.outputCost, 6);
	});

	test("keeps totals for providers whose synthetic root row is hidden", async () => {
		const mappings = await getJson<CatalogTotals>(
			cookie,
			`/admin/model-provider-mappings?search=${MANTLE_MODEL}&from=${fromDate}&to=${toDate}`,
		);

		expect(mappings).toMatchObject({
			totalRequests: 20,
			totalTokens: 200,
			totalCost: 5,
		});
	});
});
