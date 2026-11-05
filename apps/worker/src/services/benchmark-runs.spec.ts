import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { requestStop, resetShutdown } from "@/shutdown.js";

import {
	encryptProviderKeyForStorage,
	openAirsideInference,
	signAirsideInferenceResponse,
} from "@llmgateway/actions";
import * as benchmarks from "@llmgateway/benchmarks";
import { db, eq, tables } from "@llmgateway/db";

import {
	claimNextBenchmarkRun,
	processNextBenchmarkRun,
	resolveRunTargets,
} from "./benchmark-runs.js";

import type { BenchmarkResult } from "@llmgateway/benchmarks";
import type { ProviderApiFormat } from "@llmgateway/models";

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
	await db
		.delete(tables.providerCompany)
		.where(eq(tables.providerCompany.id, "worker-benchmark-company"));
	await db
		.delete(tables.providerKey)
		.where(eq(tables.providerKey.id, "worker-benchmark-key"));
	await db
		.delete(tables.user)
		.where(eq(tables.user.id, "worker-benchmark-user"));
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
		vi.stubEnv("AIRSIDE_GATEWAY_API_KEY", "test-token");
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
			inputPrice: "0",
			outputPrice: "0",
		});
	});

	afterEach(async () => {
		vi.useRealTimers();
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
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

	test("replaces every catalogue sibling region owned by an Airside deployment", async () => {
		const spy = vi
			.spyOn(benchmarks, "catalogueMappingDescriptors")
			.mockReturnValue([
				{
					modelId: MODEL_ID,
					modelName: "Worker Benchmark Model",
					providerId: CARRIER_ID,
					externalId: "catalogue-default",
					source: "catalogue",
				},
				{
					modelId: MODEL_ID,
					modelName: "Worker Benchmark Model",
					providerId: CARRIER_ID,
					externalId: "catalogue-region",
					region: "old-region",
					source: "catalogue",
				},
			]);
		try {
			const targets = await resolveRunTargets(await queueRun());
			expect(targets).toHaveLength(1);
			expect(targets[0].metadata).toMatchObject({
				source: "airside",
				externalId: "carrier-upstream-id",
				region: null,
			});
		} finally {
			spy.mockRestore();
		}
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

	test.each([false, true])(
		"renews a live run beyond the stale lease and stops its heartbeat (shutdown=%s)",
		async (shutdown) => {
			resetShutdown();
			vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
			const queued = await queueRun();
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const execute = vi.fn(async () => {
				await gate;
				return fakeResult();
			});
			const processing = processNextBenchmarkRun(execute);
			try {
				await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
				for (let hour = 0; hour < 3; hour++) {
					const stepMs = 40 * 60 * 1000;
					vi.setSystemTime(Date.now() + stepMs);
					await vi.advanceTimersByTimeAsync(60_000);
					await vi.waitFor(async () => {
						const row = await db.query.benchmarkRun.findFirst({
							where: { id: { eq: queued.id } },
						});
						expect(row!.updatedAt.getTime()).toBeGreaterThanOrEqual(
							Date.now() - 60_000,
						);
					});
					expect(await claimNextBenchmarkRun()).toBeNull();
				}
				if (shutdown) {
					requestStop();
					expect(vi.getTimerCount()).toBe(0);
				}
			} finally {
				release();
				await processing;
				resetShutdown();
			}
			expect(vi.getTimerCount()).toBe(0);
			const row = await db.query.benchmarkRun.findFirst({
				where: { id: { eq: queued.id } },
			});
			expect(row).toMatchObject({ attempts: 1, status: "completed" });
		},
	);

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

	test.each(["AIRSIDE_GATEWAY_API_KEY", "BENCHMARK_GATEWAY_API_KEY"])(
		"rejects mixed-source runs before execution when worker %s is missing",
		async (environment) => {
			vi.stubEnv(environment, "");
			const spy = vi
				.spyOn(benchmarks, "catalogueMappingDescriptors")
				.mockReturnValue([
					{
						modelId: MODEL_ID,
						modelName: "Worker Benchmark Model",
						providerId: "other-provider",
						externalId: "catalogue-upstream",
						source: "catalogue",
					},
				]);
			try {
				const run = await queueRun();
				const execute = vi.fn(async () => fakeResult());
				await processNextBenchmarkRun(execute);
				expect(execute).not.toHaveBeenCalled();
				const stored = (await db.query.benchmarkRun.findFirst({
					where: { id: { eq: run.id } },
				}))!;
				expect(stored.status).toBe("failed");
				expect(stored.error).toContain(environment);
			} finally {
				spy.mockRestore();
			}
		},
	);
	test("fails the run when no gateway key is configured", async () => {
		delete process.env.AIRSIDE_GATEWAY_API_KEY;
		const queued = await queueRun();
		await processNextBenchmarkRun(async () => fakeResult());

		const [row] = await db
			.select()
			.from(tables.benchmarkRun)
			.where(eq(tables.benchmarkRun.id, queued.id));
		expect(row.status).toBe("failed");
		expect(row.error).toContain("AIRSIDE_GATEWAY_API_KEY");
	});

	test.each([
		"provider-native",
		"openai-chat-completions",
		"openai-responses",
		"google-vertex",
	] as const)(
		"pins Airside load requests through the signed %s transport",
		async (apiFormat) => {
			await seedCarrierDeployment(apiFormat);
			const queued = await queueRun();
			const gatewayFetch = vi.fn<typeof fetch>(async (input, init) => {
				expect(String(input)).toBe(
					"http://localhost:6801/v1/internal/airside/inference",
				);
				expect(
					new Headers(init?.headers).get("Authorization") ===
						"Bearer test-token",
				).toBe(true);
				const { payload, envelope } = openAirsideInference(
					JSON.parse(String(init?.body)),
					"test-token",
				);
				expect(payload.providerKeyId).toBe("worker-benchmark-key");
				expect(payload.target.apiFormat).toBe(apiFormat);
				expect(payload.target.externalId).toBe("carrier-upstream-id");
				expect(payload.responseFormat).toBe("openai-chat-completions");
				expect(payload.pricing).toMatchObject({
					inputPrice: "0.000001",
					outputPrice: "0.000002",
					cacheReadInputPrice: "0.0000001",
					cacheWriteInputPrice: "0.0000012",
				});
				expect(
					payload.endpoint.includes("carrier-upstream-id") ||
						JSON.parse(payload.body).model === "carrier-upstream-id",
				).toBe(true);
				expect(String(init?.body).includes("benchmark-provider-key")).toBe(
					false,
				);
				return new Response("data: [DONE]\n\n", {
					headers: {
						"x-airside-inference": signAirsideInferenceResponse(envelope, 200),
						"Content-Type": "text/event-stream",
					},
				});
			});
			vi.stubGlobal("fetch", gatewayFetch);
			await processNextBenchmarkRun(async (options) => {
				await options.fetch!(options.client.url, {
					method: "POST",
					body: JSON.stringify({
						model: options.targets[0].model,
						messages: [{ role: "user", content: "hello" }],
						stream: true,
					}),
				});
				return fakeResult();
			});
			expect(gatewayFetch).toHaveBeenCalledOnce();
			expect(
				(
					await db.query.benchmarkRun.findFirst({
						where: { id: { eq: queued.id } },
					})
				)?.status,
			).toBe("completed");
		},
	);
	test("fails operator configuration when the runner catches a removed listing", async () => {
		await seedCarrierDeployment("openai-chat-completions");
		const run = await queueRun();
		await processNextBenchmarkRun(async (options) => {
			await db
				.update(tables.modelProviderMapping)
				.set({ status: "inactive" })
				.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
			await expect(
				options.fetch!(options.client.url, {
					method: "POST",
					body: JSON.stringify({
						model: options.targets[0].model,
						messages: [],
					}),
				}),
			).rejects.toThrow("no longer active");
			return fakeResult();
		});
		const stored = (await db.query.benchmarkRun.findFirst({
			where: { id: { eq: run.id } },
		}))!;
		expect(stored.status).toBe("failed");
		expect(stored.error).toContain("no longer active");
	});
	test("fails operator configuration when the runner catches an in-flight credential rotation", async () => {
		await seedCarrierDeployment("openai-chat-completions");
		const run = await queueRun();
		const gatewayFetch = signedGatewayResponse();
		vi.stubGlobal("fetch", gatewayFetch);
		await processNextBenchmarkRun(async (options) => {
			const init = {
				method: "POST",
				body: JSON.stringify({
					model: options.targets[0].model,
					messages: [{ role: "user", content: "hello" }],
					stream: true,
				}),
			};
			await (await options.fetch!(options.client.url, init)).text();
			await db
				.update(tables.providerKey)
				.set(
					encryptProviderKeyForStorage(
						"rotated-benchmark-key",
						"worker-benchmark-key",
						null,
					),
				)
				.where(eq(tables.providerKey.id, "worker-benchmark-key"));
			await expect(options.fetch!(options.client.url, init)).rejects.toThrow(
				"credential changed",
			);
			return fakeResult();
		});
		expect(gatewayFetch).toHaveBeenCalledOnce();
		const stored = (await db.query.benchmarkRun.findFirst({
			where: { id: { eq: run.id } },
		}))!;
		expect(stored.status).toBe("failed");
		expect(stored.error).toContain("credential changed");
	});
	test("keeps a genuine signed upstream error as benchmark output rather than operator failure", async () => {
		await seedCarrierDeployment("openai-chat-completions");
		const run = await queueRun();
		vi.stubGlobal("fetch", signedGatewayResponse(500));
		await processNextBenchmarkRun(async (options) => {
			const response = await options.fetch!(options.client.url, {
				method: "POST",
				body: JSON.stringify({
					model: options.targets[0].model,
					messages: [{ role: "user", content: "hello" }],
					stream: true,
				}),
			});
			expect(response.status).toBe(500);
			return fakeResult();
		});
		expect(
			(await db.query.benchmarkRun.findFirst({ where: { id: { eq: run.id } } }))
				?.status,
		).toBe("completed");
	});
	test("does nothing when the queue is empty", async () => {
		expect(await processNextBenchmarkRun(async () => fakeResult())).toBe(false);
	});
});
async function seedCarrierDeployment(apiFormat: ProviderApiFormat) {
	vi.stubEnv("GATEWAY_API_KEY_HASH_SECRET", "benchmark-test-secret");
	vi.stubEnv("GATEWAY_URL", "http://localhost:6801");
	await db.insert(tables.user).values({
		id: "worker-benchmark-user",
		name: "Verification User",
		email: "benchmark@example.com",
	});
	await db
		.insert(tables.providerCompany)
		.values({ id: "worker-benchmark-company", name: "Verification Company" });
	await db.insert(tables.providerKey).values({
		id: "worker-benchmark-key",
		provider: CARRIER_ID,
		managed: true,
		baseUrl: "https://example.com/v1",
		...encryptProviderKeyForStorage(
			"benchmark-provider-key",
			"worker-benchmark-key",
			null,
		),
	});
	await db.insert(tables.providerClaim).values({
		providerCompanyId: "worker-benchmark-company",
		providerId: CARRIER_ID,
		kind: "custom",
		matchedDomain: "example.com",
		status: "active",
		claimedBy: "worker-benchmark-user",
		providerKeyId: "worker-benchmark-key",
	});
	await db.insert(tables.providerDraftModel).values({
		providerCompanyId: "worker-benchmark-company",
		providerId: CARRIER_ID,
		modelName: MODEL_ID,
		externalId: "carrier-upstream-id",
		status: "active",
		apiFormat,
	});
	await db
		.update(tables.modelProviderMapping)
		.set({
			apiFormat,
			inputPrice: "0.000001",
			outputPrice: "0.000002",
			cacheReadInputPrice: "0.0000001",
			cacheWriteInputPrice: "0.0000012",
		})
		.where(eq(tables.modelProviderMapping.id, MAPPING_ID));
}
function signedGatewayResponse(status = 200) {
	return vi.fn<typeof fetch>(async (_input, init) => {
		const { envelope } = openAirsideInference(
			JSON.parse(String(init?.body)),
			"test-token",
		);
		return new Response(
			status === 200
				? "data: [DONE]\n\n"
				: JSON.stringify({ error: "Upstream unavailable" }),
			{
				status,
				headers: {
					"x-airside-inference": signAirsideInferenceResponse(envelope, status),
					"Content-Type":
						status === 200 ? "text/event-stream" : "application/json",
				},
			},
		);
	});
}
