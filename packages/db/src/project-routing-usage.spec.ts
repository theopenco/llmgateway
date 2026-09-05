import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { waitForSwrMirrorWrites } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { cdb } from "./cdb.js";
import { db } from "./db.js";
import { getProjectRoutingUsage } from "./project-routing-usage.js";
import { metricsKey } from "./provider-metrics.js";
import { projectHourlyModelStats as stats } from "./schema.js";

let projectId: string;
const modelId = "routing-usage-model";
const combinations = ["deepinfra", "fireworks", "deepseek"].map(
	(providerId) => ({
		modelId,
		providerId,
	}),
);

beforeEach(() => {
	projectId = `routing-usage-${crypto.randomUUID()}`;
});

afterEach(async () => {
	vi.restoreAllMocks();
	await waitForSwrMirrorWrites();
	await db.delete(stats).where(eq(stats.projectId, projectId));
});

function row(overrides: Partial<typeof stats.$inferInsert> = {}) {
	return {
		projectId,
		usedModel: modelId,
		usedProvider: "deepinfra",
		hourTimestamp: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000),
		requestCount: 100,
		inputTokens: "10000000",
		cachedTokens: "9950000",
		outputTokens: "50000",
		...overrides,
	};
}

describe("getProjectRoutingUsage", () => {
	it("logs and falls back to configured pricing when usage is unavailable", async () => {
		const error = new Error("Usage query unavailable");
		vi.spyOn(cdb, "select").mockImplementationOnce(() => {
			throw error;
		});
		const warn = vi.spyOn(logger, "warn");
		expect(await getProjectRoutingUsage(projectId, combinations)).toEqual(
			new Map(),
		);
		expect(warn).toHaveBeenCalledWith(
			"Routing usage unavailable; using configured pricing",
			{ error: error.message },
		);
	});

	it("uses provider hits and a token-weighted model mix for unseen providers", async () => {
		await db.insert(stats).values([
			row({ cachedTokens: "9000000" }),
			row({
				usedProvider: "fireworks",
				inputTokens: "20000000",
				cachedTokens: "19900000",
			}),
		]);
		const usage = await getProjectRoutingUsage(projectId, combinations);
		expect(usage.get(metricsKey(modelId, "deepinfra"))).toEqual({
			cacheHitRate: 0.9,
			cacheOutputRatio: 100000 / 30000000,
		});
		expect(usage.get(metricsKey(modelId, "fireworks"))?.cacheHitRate).toBe(
			0.995,
		);
		expect(usage.get(metricsKey(modelId, "deepseek"))?.cacheHitRate).toBe(
			28900000 / 30000000,
		);
	});

	it("uses only this project's recent model usage without response-cache buckets", async () => {
		await db.insert(stats).values([
			row(),
			row({ usedModel: "unrelated-model", cachedTokens: "0" }),
			row({
				hourTimestamp: new Date(Date.now() - 90_000_000),
				cachedTokens: "0",
			}),
			row({ usedProvider: "fireworks", cacheCount: 1, cachedTokens: "0" }),
		]);
		expect(
			await getProjectRoutingUsage("unrelated-project", combinations),
		).toEqual(new Map());
		const usage = await getProjectRoutingUsage(projectId, combinations);
		expect(usage.get(metricsKey(modelId, "fireworks"))).toEqual({
			cacheHitRate: 0.995,
			cacheOutputRatio: 0.005,
		});
	});

	it.each([
		{ requestCount: 19 },
		{ requestCount: 100, errorCount: 81 },
		{ inputTokens: "99999" },
		{ inputTokens: "0", cachedTokens: "0" },
	])("keeps defaults for insufficient usage: %o", async (overrides) => {
		await db.insert(stats).values(row(overrides));
		expect(await getProjectRoutingUsage(projectId, combinations)).toEqual(
			new Map(),
		);
	});

	it("caps cached tokens and allows an observed zero output ratio", async () => {
		await db
			.insert(stats)
			.values(row({ cachedTokens: "11000000", outputTokens: "0" }));
		const usage = await getProjectRoutingUsage(projectId, combinations);
		expect(usage.get(metricsKey(modelId, "deepinfra"))).toEqual({
			cacheHitRate: 1,
			cacheOutputRatio: 0,
		});
	});

	it("reuses its cached query despite the moving time boundary", async () => {
		await db.insert(stats).values(row());
		const first = await getProjectRoutingUsage(projectId, combinations);
		await db.delete(stats).where(eq(stats.projectId, projectId));
		expect(await getProjectRoutingUsage(projectId, combinations)).toEqual(
			first,
		);
	});
});
