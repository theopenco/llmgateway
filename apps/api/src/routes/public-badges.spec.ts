import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { resetLocalPublicResponseCache } from "@/lib/public-response-cache.js";
import { deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, tables } from "@llmgateway/db";
import { models, type ModelDefinition } from "@llmgateway/models";

import { cheapestPrice, formatUptime, uptimeColor } from "./public-badges.js";
import { statusPageProviders } from "./public-providers-status.js";

const HOUR_MS = 60 * 60 * 1000;
const provider = statusPageProviders()[0];
const pricedModel = (models as readonly ModelDefinition[]).find(
	(model) => model.family !== "llmgateway" && cheapestPrice(model) !== null,
)!;

describe("public badges", () => {
	beforeEach(async () => {
		await deleteAll();
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await redisClient.flushdb();
		resetLocalPublicResponseCache();
	});

	afterEach(async () => {
		await db.delete(tables.modelProviderMappingHistoryHourly);
		await deleteAll();
	});

	test("renders a provider's measured uptime as SVG", async () => {
		await db.insert(tables.modelProviderMappingHistoryHourly).values({
			modelId: "badge-test-model",
			providerId: provider.id,
			modelProviderMappingId: "badge-test",
			usedMode: "credits",
			hourTimestamp: new Date(
				Math.floor((Date.now() - HOUR_MS) / HOUR_MS) * HOUR_MS,
			),
			logsCount: 200,
			upstreamErrorsCount: 1,
		});

		const res = await app.request(
			`/public/badges/provider/${provider.id}/uptime.svg`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("image/svg+xml");
		expect(res.headers.get("cache-control")).toContain("max-age=300");
		const svg = await res.text();
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg).toContain("99.50%");
		expect(svg).toContain("(90d)");
	});

	test("says so when a provider has no measured traffic", async () => {
		const res = await app.request(
			`/public/badges/provider/${provider.id}/uptime.svg?window=24h`,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("no data");
	});

	test("renders a model's lowest price", async () => {
		const res = await app.request(
			`/public/badges/model/${pricedModel.id}/price.svg?style=flat-square`,
		);
		expect(res.status).toBe(200);
		const svg = await res.text();
		expect(svg).toContain("per 1M tokens");
		expect(svg).toMatch(/ in · .* out|free/);
	});

	test("answers unknown ids with a 404 badge", async () => {
		for (const path of [
			"/public/badges/provider/not-a-provider/uptime.svg",
			"/public/badges/model/not-a-model/price.svg",
			"/public/badges/model/auto/price.svg",
		]) {
			const res = await app.request(path);
			expect(res.status).toBe(404);
			expect(res.headers.get("content-type")).toContain("image/svg+xml");
			expect(await res.text()).toContain("not found");
		}
	});

	test("never rounds uptime up to 100%", () => {
		expect(formatUptime(99.999)).toBe("99.99%");
		expect(formatUptime(100)).toBe("100%");
		expect(uptimeColor(99.95)).toBe("brightgreen");
		expect(uptimeColor(96)).toBe("yellow");
		expect(uptimeColor(80)).toBe("red");
	});

	test("ignores deactivated mappings when pricing a model", () => {
		const model = {
			...pricedModel,
			providers: [
				{
					...pricedModel.providers[0],
					inputPrice: "1e-6",
					outputPrice: "1e-6",
					deactivatedAt: new Date("2020-01-01"),
				},
				{
					...pricedModel.providers[0],
					inputPrice: "3e-6",
					outputPrice: "9e-6",
					deactivatedAt: undefined,
					deprecatedAt: undefined,
				},
			],
		} as ModelDefinition;
		expect(cheapestPrice(model)).toEqual({
			inputPrice: "3e-6",
			outputPrice: "9e-6",
		});
	});
});
