import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { resetModelSearchRowsMemo } from "@/routes/internal-models.js";

import { db, inArray, tables } from "@llmgateway/db";

const PREFIX = "search-spec";
const MODEL_IDS = [
	`${PREFIX}-sonnet`,
	`${PREFIX}-gpt`,
	`${PREFIX}-gpt-mini`,
	`${PREFIX}-retired`,
];
const PROVIDER_IDS = [`${PREFIX}-anthropic`, `${PREFIX}-openai`];

interface SearchResponse {
	models: Array<{
		id: string;
		name: string;
		monthKey: string;
		monthLabel: string;
		providerIds: string[];
		free: boolean;
	}>;
	providers: Array<{ id: string; name: string }>;
	nextCursor: string | null;
	total: number;
	groupedByMonth: boolean;
}

async function clearFixtures() {
	await db
		.delete(tables.modelProviderMapping)
		.where(inArray(tables.modelProviderMapping.modelId, MODEL_IDS));
	await db.delete(tables.model).where(inArray(tables.model.id, MODEL_IDS));
	await db
		.delete(tables.provider)
		.where(inArray(tables.provider.id, PROVIDER_IDS));
}

async function search(query: string): Promise<SearchResponse> {
	const response = await app.request(`/internal/models/search?${query}`);
	expect(response.status).toBe(200);
	return (await response.json()) as SearchResponse;
}

describe("GET /internal/models/search", () => {
	beforeEach(async () => {
		await clearFixtures();
		await db.insert(tables.provider).values([
			{
				id: `${PREFIX}-anthropic`,
				name: "Spec Anthropic",
				description: "test",
			},
			{ id: `${PREFIX}-openai`, name: "Spec OpenAI", description: "test" },
		]);
		await db.insert(tables.model).values([
			{
				id: `${PREFIX}-sonnet`,
				name: "Spec Sonnet",
				family: "spec-claude",
				aliases: ["spec-sonnet-alias"],
				createdAt: new Date("2031-08-10T00:00:00.000Z"),
				releasedAt: new Date("2031-08-01T00:00:00.000Z"),
				free: true,
			},
			{
				id: `${PREFIX}-gpt`,
				name: "Spec GPT",
				family: "spec-gpt",
				createdAt: new Date("2031-07-02T00:00:00.000Z"),
				releasedAt: new Date("2031-07-02T00:00:00.000Z"),
			},
			{
				id: `${PREFIX}-gpt-mini`,
				name: "Spec GPT Mini",
				family: "spec-gpt",
				createdAt: new Date("2031-07-01T00:00:00.000Z"),
				releasedAt: new Date("2031-07-01T00:00:00.000Z"),
			},
			{
				id: `${PREFIX}-retired`,
				name: "Spec Retired",
				family: "spec-gpt",
				createdAt: new Date("2031-09-01T00:00:00.000Z"),
				releasedAt: new Date("2031-09-01T00:00:00.000Z"),
			},
		]);
		await db.insert(tables.modelProviderMapping).values([
			{
				id: `${PREFIX}-sonnet-mapping`,
				modelId: `${PREFIX}-sonnet`,
				providerId: `${PREFIX}-anthropic`,
				externalId: "spec-sonnet",
				requestPrice: "0",
			},
			{
				id: `${PREFIX}-gpt-mapping`,
				modelId: `${PREFIX}-gpt`,
				providerId: `${PREFIX}-openai`,
				externalId: "spec-gpt",
			},
			{
				id: `${PREFIX}-gpt-mini-mapping`,
				modelId: `${PREFIX}-gpt-mini`,
				providerId: `${PREFIX}-openai`,
				externalId: "spec-gpt-mini",
			},
			{
				id: `${PREFIX}-retired-mapping`,
				modelId: `${PREFIX}-retired`,
				providerId: `${PREFIX}-openai`,
				externalId: "spec-retired",
				deactivatedAt: new Date("2020-01-01T00:00:00.000Z"),
			},
		]);
		resetModelSearchRowsMemo();
	});

	afterEach(async () => {
		await clearFixtures();
		resetModelSearchRowsMemo();
	});

	test("pages the catalogue newest month first and skips deactivated models", async () => {
		const first = await search("limit=1");
		expect(first.groupedByMonth).toBe(true);
		expect(first.providers).toEqual([]);
		expect(first.models.map((model) => model.id)).toEqual([`${PREFIX}-sonnet`]);
		expect(first.models[0]).toMatchObject({
			monthKey: "2031-08",
			monthLabel: "August 2031",
			providerIds: [`${PREFIX}-anthropic`],
			free: true,
		});
		expect(first.nextCursor).toBe("m:2031-07:0");

		const second = await search(`limit=1&cursor=${first.nextCursor}`);
		expect(second.models.map((model) => model.id)).toEqual([
			`${PREFIX}-gpt`,
			`${PREFIX}-gpt-mini`,
		]);
		expect(second.models.every((model) => model.monthKey === "2031-07")).toBe(
			true,
		);
		expect(second.providers).toEqual([]);

		const allIds = new Set<string>();
		let cursor: string | null = null;
		do {
			const page: SearchResponse = await search(
				`limit=50${cursor ? `&cursor=${cursor}` : ""}`,
			);
			for (const model of page.models) {
				allIds.add(model.id);
			}
			cursor = page.nextCursor;
		} while (cursor);
		expect(allIds.has(`${PREFIX}-retired`)).toBe(false);
		expect(allIds.has(`${PREFIX}-sonnet`)).toBe(true);
	});

	test("ranks query hits and returns matching providers on the first page only", async () => {
		const page = await search(`q=${PREFIX}-gpt`);
		expect(page.groupedByMonth).toBe(false);
		expect(page.total).toBe(2);
		expect(page.models.map((model) => model.id)).toEqual([
			`${PREFIX}-gpt`,
			`${PREFIX}-gpt-mini`,
		]);
		expect(page.nextCursor).toBeNull();

		const byAlias = await search("q=spec-sonnet-alias");
		expect(byAlias.models.map((model) => model.id)).toEqual([
			`${PREFIX}-sonnet`,
		]);

		const providers = await search("q=spec+anthropic");
		expect(providers.providers).toEqual([
			{ id: `${PREFIX}-anthropic`, name: "Spec Anthropic" },
		]);
		const paged = await search("q=spec+anthropic&cursor=o:0");
		expect(paged.providers).toEqual([]);

		const typo = await search("q=spec+sonet");
		expect(typo.models.map((model) => model.id)).toEqual([`${PREFIX}-sonnet`]);
	});

	test("rejects out-of-range limits and oversized queries", async () => {
		expect((await app.request("/internal/models/search?limit=0")).status).toBe(
			400,
		);
		expect((await app.request("/internal/models/search?limit=51")).status).toBe(
			400,
		);
		expect(
			(await app.request(`/internal/models/search?q=${"a".repeat(101)}`))
				.status,
		).toBe(400);
	});
});
