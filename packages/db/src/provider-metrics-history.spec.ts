import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { waitForSwrMirrorWrites } from "@llmgateway/cache";
import { DEFAULT_ROUTING_HISTORY } from "@llmgateway/shared/routing-config";

import { db } from "./db.js";
import { getProviderMetricsFromHistory } from "./provider-metrics-history.js";
import { metricsKey } from "./provider-metrics.js";
import { modelProviderMappingHistory } from "./schema.js";

let modelId: string | undefined;

afterEach(async () => {
	await waitForSwrMirrorWrites();
	if (modelId) {
		await db
			.delete(modelProviderMappingHistory)
			.where(eq(modelProviderMappingHistory.modelId, modelId));
		modelId = undefined;
	}
});

describe("getProviderMetricsFromHistory", () => {
	it("uses only credit-funded traffic for routing health", async () => {
		const testModelId = `routing-credits-${crypto.randomUUID()}`;
		modelId = testModelId;
		const providerId = "routing-provider";
		const mappingId = "routing-mapping";
		const minuteTimestamp = new Date(Math.floor(Date.now() / 60_000) * 60_000);

		await db.insert(modelProviderMappingHistory).values([
			{
				modelId: testModelId,
				providerId,
				modelProviderMappingId: mappingId,
				usedMode: "credits",
				minuteTimestamp,
				logsCount: 10,
				totalOutputTokens: 100,
				totalDuration: 1_000,
				totalTimeToFirstToken: 1_000,
				timeToFirstTokenCount: 10,
			},
			{
				modelId: testModelId,
				providerId,
				modelProviderMappingId: mappingId,
				usedMode: "api-keys",
				minuteTimestamp,
				logsCount: 90,
				errorsCount: 90,
				upstreamErrorsCount: 90,
				totalOutputTokens: 900,
				totalDuration: 9_000,
				totalTimeToFirstToken: 900_000,
				timeToFirstTokenCount: 90,
			},
		]);

		const metrics = await getProviderMetricsFromHistory(
			[{ modelId: testModelId, providerId }],
			DEFAULT_ROUTING_HISTORY,
		);

		expect(metrics.get(metricsKey(testModelId, providerId))).toEqual({
			modelId: testModelId,
			providerId,
			uptime: 100,
			averageLatency: 100,
			throughput: 100,
			totalRequests: 10,
		});
	});
});
