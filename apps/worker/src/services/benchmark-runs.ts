import {
	buildBenchmarkTargets,
	catalogueMappingDescriptors,
	getBuiltInProfile,
	runBenchmark,
	type BenchmarkMappingDescriptor,
	type BenchmarkResult,
	type BenchmarkTarget,
} from "@llmgateway/benchmarks";
import { and, asc, db, eq, lt, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";

type BenchmarkRunRow = typeof tables.benchmarkRun.$inferSelect;

// A run is bounded by its own per-target budget, so anything still "running"
// well past the worst case is a worker that died mid-run.
const STALE_RUNNING_MS = 60 * 60 * 1000;
const MAX_RUN_ATTEMPTS = 2;
const STALE_FEEDBACK = "The benchmark worker stopped before the run finished.";

export async function claimNextBenchmarkRun(): Promise<BenchmarkRunRow | null> {
	return await db.transaction(async (tx) => {
		const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
		const staleRuns = await tx
			.select({
				id: tables.benchmarkRun.id,
				attempts: tables.benchmarkRun.attempts,
			})
			.from(tables.benchmarkRun)
			.where(
				and(
					eq(tables.benchmarkRun.status, "running"),
					lt(tables.benchmarkRun.updatedAt, staleBefore),
				),
			)
			.for("update", { skipLocked: true });
		for (const staleRun of staleRuns) {
			const exhausted = staleRun.attempts >= MAX_RUN_ATTEMPTS;
			await tx
				.update(tables.benchmarkRun)
				.set(
					exhausted
						? {
								status: "failed",
								error: STALE_FEEDBACK,
								completedAt: new Date(),
							}
						: { status: "queued", startedAt: null },
				)
				.where(
					and(
						eq(tables.benchmarkRun.id, staleRun.id),
						eq(tables.benchmarkRun.status, "running"),
						eq(tables.benchmarkRun.attempts, staleRun.attempts),
						lt(tables.benchmarkRun.updatedAt, staleBefore),
					),
				);
		}

		const [run] = await tx
			.select()
			.from(tables.benchmarkRun)
			.where(eq(tables.benchmarkRun.status, "queued"))
			.orderBy(asc(tables.benchmarkRun.createdAt))
			.limit(1)
			.for("update", { skipLocked: true });
		if (!run) {
			return null;
		}
		const [claimed] = await tx
			.update(tables.benchmarkRun)
			.set({
				status: "running",
				startedAt: new Date(),
				completedAt: null,
				error: null,
				attempts: run.attempts + 1,
			})
			.where(
				and(
					eq(tables.benchmarkRun.id, run.id),
					eq(tables.benchmarkRun.status, "queued"),
					eq(tables.benchmarkRun.attempts, run.attempts),
				),
			)
			.returning();
		return claimed ?? null;
	});
}

function rowDescriptor(
	row: typeof tables.modelProviderMapping.$inferSelect & {
		modelName: string;
	},
): BenchmarkMappingDescriptor {
	return {
		modelId: row.modelId,
		modelName: row.modelName,
		providerId: row.providerId,
		region: row.region,
		externalId: row.externalId,
		deactivatedAt: row.deactivatedAt,
		quantization: row.quantization,
		stability: row.stability,
		inputPrice: row.inputPrice,
		outputPrice: row.outputPrice,
		requestPrice: row.requestPrice ?? "0",
		contextSize: row.contextSize,
		maxOutput: row.maxOutput,
		source: row.source,
	};
}

/**
 * Resolved the same way the API resolved it when the run was queued: the
 * catalogue definition wins where it exists, and database rows supply anything
 * it does not know about, which is what makes an Airside listing runnable.
 */
export async function resolveRunTargets(
	run: BenchmarkRunRow,
): Promise<BenchmarkTarget[]> {
	const rows = await db
		.select({
			mapping: tables.modelProviderMapping,
			modelName: tables.model.name,
		})
		.from(tables.modelProviderMapping)
		.innerJoin(
			tables.model,
			eq(tables.model.id, tables.modelProviderMapping.modelId),
		)
		.where(
			and(
				eq(tables.modelProviderMapping.modelId, run.modelId),
				eq(tables.modelProviderMapping.status, "active"),
			),
		);

	let catalogue: BenchmarkMappingDescriptor[] = [];
	try {
		catalogue = catalogueMappingDescriptors(run.modelId);
	} catch {
		catalogue = [];
	}

	const merged = new Map<string, BenchmarkMappingDescriptor>(
		catalogue.map((descriptor) => [
			`${descriptor.providerId}:${descriptor.region ?? ""}`,
			descriptor,
		]),
	);
	for (const row of rows) {
		const descriptor = rowDescriptor({
			...row.mapping,
			modelName: row.modelName,
		});
		const key = `${descriptor.providerId}:${descriptor.region ?? ""}`;
		if (!merged.has(key)) {
			merged.set(key, descriptor);
		}
	}

	return buildBenchmarkTargets({
		descriptors: [...merged.values()],
		mappings: run.mappings.length > 0 ? run.mappings : undefined,
	});
}

function stripTrials(result: BenchmarkResult): Record<string, unknown> {
	// The summary is what the dashboard renders; keeping every trial's stream
	// chunks would be megabytes of jsonb per run.
	return { ...result, trials: [] };
}

export async function processNextBenchmarkRun(
	execute: typeof runBenchmark = runBenchmark,
): Promise<boolean> {
	const run = await claimNextBenchmarkRun();
	if (!run) {
		return false;
	}

	const apiKey = process.env.BENCHMARK_GATEWAY_API_KEY?.trim();
	if (!apiKey) {
		await db
			.update(tables.benchmarkRun)
			.set({
				status: "failed",
				error: "BENCHMARK_GATEWAY_API_KEY is not configured.",
				completedAt: new Date(),
			})
			.where(eq(tables.benchmarkRun.id, run.id));
		return true;
	}

	try {
		const targets = await resolveRunTargets(run);
		const profile = getBuiltInProfile(run.profile);
		const result = await execute({
			client: {
				url: `${getGatewayApiBaseUrl()}/chat/completions`,
				apiKey,
			},
			targets,
			cases: profile.cases,
			budgetMs: run.budgetMs,
			timeoutMs: run.timeoutMs,
			seed: run.seed,
			concurrency: profile.defaults?.concurrency ?? 1,
			...(run.runs === null ? {} : { runs: run.runs }),
			// Admin runs never keep response bodies: they are large, and a
			// benchmark prompt's completion is not something the dashboard shows.
			includeResponses: false,
		});

		await db
			.update(tables.benchmarkRun)
			.set({
				status: "completed",
				result: stripTrials(result),
				completedAt: new Date(),
			})
			.where(
				and(
					eq(tables.benchmarkRun.id, run.id),
					eq(tables.benchmarkRun.status, "running"),
					eq(tables.benchmarkRun.attempts, run.attempts),
				),
			);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.error(
			"Benchmark run failed",
			error instanceof Error ? error : new Error(message),
			{ benchmarkRunId: run.id },
		);
		await db
			.update(tables.benchmarkRun)
			.set({
				status: "failed",
				error: message.slice(0, 2000),
				completedAt: new Date(),
			})
			.where(
				and(
					eq(tables.benchmarkRun.id, run.id),
					eq(tables.benchmarkRun.status, "running"),
					eq(tables.benchmarkRun.attempts, run.attempts),
				),
			);
	}
	return true;
}
