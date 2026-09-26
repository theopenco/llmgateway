import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import {
	claimNextBenchmarkRun,
	processNextBenchmarkRun,
	resolveRunTargets,
} from "./benchmark-runs.js";

import type { BenchmarkResult } from "@llmgateway/benchmarks";

const originalGatewayKey = process.env.BENCHMARK_GATEWAY_API_KEY;

const CARRIER_ID = "worker-benchmark-carrier";
const MODEL_ID = "worker-benchmark-model";
const MAPPING_ID = "worker-benchmark-mapping";

function fakeResult(): BenchmarkResult {
	return {
		schemaVersion: 2,
		startedAt: new Date().toISOString(),
		finishedAt: new Date().toISOString(),
		durationMs: 1,
		config: {
			url: "https://example.com/v1/chat/completions",
			runs: null,
			warmupRuns: null,
			concurrency: 1,
			timeoutMs: 1000,
			budgetMs: 1000,
			seed: 1,
			includeResponses: false,
			referenceTargetId: `${CARRIER_ID}/${MODEL_ID}`,
			disableCache: true,
			disableFallback: true,
			request: {},
		},
		targets: [],
		cases: [],
		summary: {
			targets: [],
			cases: [],
			categories: [],
			difficulties: [],
			dimensions: [],
			pairwiseAgreement: [],
			load: [],
		},
		trials: [
			{
				targetId: `${CARRIER_ID}/${MODEL_ID}`,
				caseId: "case",
				kind: "quality",
				run: 1,
				seed: 1,
				parameters: {},
				warmup: false,
				startedOffsetMs: 0,
				finishedOffsetMs: 1,
				response: {
					content: "",
					reasoning: "",
					toolCalls: [],
					finishReason: "stop",
					responseModel: null,
					requestId: null,
					usage: {
						promptTokens: 1,
						completionTokens: 1,
						reasoningTokens: null,
						visibleCompletionTokens: 1,
						raw: null,
					},
					timing: {
						headersMs: null,
						firstEventMs: null,
						firstReasoningMs: null,
						firstContentMs: null,
						lastContentMs: null,
						generationMs: null,
						totalMs: 1,
						visibleTokensPerSecond: null,
						contentChunkCount: 0,
						averageContentChunkCharacters: null,
						maxContentStallMs: null,
						finalContentBurstRatio: null,
						buffered: null,
					},
					streamChunks: [],
					error: null,
					agent: null,
				},
				evaluation: null,
				estimatedCostUsd: null,
			},
		],
	};
}

async function clearFixtures() {
	await db
		.delete(tables.benchmarkRun)
		.where(eq(tables.benchmarkRun.modelId, MODEL_ID));
	await db
		.delete(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
	await db.delete(tables.model).where(eq(tables.model.id, MODEL_ID));
	await db.delete(tables.provider).where(eq(tables.provider.id, CARRIER_ID));
}

async function queueRun(profile: "smoke" | "coding" = "smoke") {
	const [run] = await db
		.insert(tables.benchmarkRun)
		.values({ modelId: MODEL_ID, profile, budgetMs: 10_000, timeoutMs: 5_000 })
		.returning();
	return run;
}

describe("benchmark run worker", () => {
	beforeEach(async () => {
		process.env.BENCHMARK_GATEWAY_API_KEY = "test-token";
		await clearFixtures();
		await db.insert(tables.provider).values({
			id: CARRIER_ID,
			name: "Worker Benchmark Carrier",
			description: "test",
		});
		await db.insert(tables.model).values({
			id: MODEL_ID,
			name: "Worker Benchmark Model",
			family: "test",
		});
		await db.insert(tables.modelProviderMapping).values({
			id: MAPPING_ID,
			modelId: MODEL_ID,
			providerId: CARRIER_ID,
			externalId: "carrier-upstream-id",
			source: "airside",
		});
	});

	afterEach(async () => {
		await clearFixtures();
		if (originalGatewayKey === undefined) {
			delete process.env.BENCHMARK_GATEWAY_API_KEY;
		} else {
			process.env.BENCHMARK_GATEWAY_API_KEY = originalGatewayKey;
		}
	});

	test("resolves a database-only mapping into a pinned target", async () => {
		const run = await queueRun();
		const targets = await resolveRunTargets(run);
		expect(targets).toEqual([
			expect.objectContaining({
				id: `${CARRIER_ID}/${MODEL_ID}`,
				model: `${CARRIER_ID}/${MODEL_ID}`,
				mapping: CARRIER_ID,
			}),
		]);
		expect(targets[0].metadata?.source).toBe("airside");
		expect(targets[0].metadata?.externalId).toBe("carrier-upstream-id");
	});

	test("claims a queued run exactly once", async () => {
		await queueRun();
		const first = await claimNextBenchmarkRun();
		expect(first?.status).toBe("running");
		expect(first?.attempts).toBe(1);
		expect(await claimNextBenchmarkRun()).toBeNull();
	});

	test("stores the result without trials and marks the run completed", async () => {
		const queued = await queueRun();
		const processed = await processNextBenchmarkRun(async () => fakeResult());
		expect(processed).toBe(true);

		const [row] = await db
			.select()
			.from(tables.benchmarkRun)
			.where(eq(tables.benchmarkRun.id, queued.id));
		expect(row.status).toBe("completed");
		expect(row.completedAt).not.toBeNull();
		// Trials are dropped so one run cannot write megabytes of jsonb.
		expect(row.result?.trials).toEqual([]);
		expect(row.result?.schemaVersion).toBe(2);
	});

	test("records the failure when the run throws", async () => {
		const queued = await queueRun();
		await processNextBenchmarkRun(async () => {
			throw new Error("upstream exploded");
		});

		const [row] = await db
			.select()
			.from(tables.benchmarkRun)
			.where(eq(tables.benchmarkRun.id, queued.id));
		expect(row.status).toBe("failed");
		expect(row.error).toBe("upstream exploded");
	});

	test("fails the run when no gateway key is configured", async () => {
		delete process.env.BENCHMARK_GATEWAY_API_KEY;
		const queued = await queueRun();
		await processNextBenchmarkRun(async () => fakeResult());

		const [row] = await db
			.select()
			.from(tables.benchmarkRun)
			.where(eq(tables.benchmarkRun.id, queued.id));
		expect(row.status).toBe("failed");
		expect(row.error).toContain("BENCHMARK_GATEWAY_API_KEY");
	});

	test("does nothing when the queue is empty", async () => {
		expect(await processNextBenchmarkRun(async () => fakeResult())).toBe(false);
	});
});
