import { getStopSignal } from "@/shutdown.js";

import {
	createAirsideGatewayFetch,
	prepareProviderModelVerificationRequest,
	airsideInferencePricing,
} from "@llmgateway/actions";
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

import {
	liveVerificationMapping,
	currentCredentialSource,
} from "./daily-model-verifications.js";
import { resolveCredential } from "./model-verifications.js";

import type { ModelVerificationRequest } from "@llmgateway/actions";

type BenchmarkRunRow = typeof tables.benchmarkRun.$inferSelect;

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

	const airsideProviders = new Set(
		rows
			.filter((row) => row.mapping.source === "airside")
			.map((row) => row.mapping.providerId),
	);
	const merged = new Map<string, BenchmarkMappingDescriptor>(
		catalogue
			.filter((descriptor) => !airsideProviders.has(descriptor.providerId))
			.map((descriptor) => [
				`${descriptor.providerId}:${descriptor.region ?? ""}`,
				descriptor,
			]),
	);
	for (const row of rows) {
		if (
			row.mapping.source !== "airside" &&
			airsideProviders.has(row.mapping.providerId)
		) {
			continue;
		}
		const descriptor = rowDescriptor({
			...row.mapping,
			modelName: row.modelName,
		});
		const key = `${descriptor.providerId}:${descriptor.region ?? ""}`;
		if (!merged.has(key) || descriptor.source === "airside") {
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

	let heartbeat: Promise<void> | undefined;
	const timer = setInterval(() => {
		if (heartbeat) {
			return;
		}
		heartbeat = (async () => {
			try {
				await db
					.update(tables.benchmarkRun)
					.set({ updatedAt: new Date() })
					.where(
						and(
							eq(tables.benchmarkRun.id, run.id),
							eq(tables.benchmarkRun.status, "running"),
							eq(tables.benchmarkRun.attempts, run.attempts),
						),
					);
			} catch (error) {
				logger.error(
					"Benchmark heartbeat failed",
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				heartbeat = undefined;
			}
		})();
	}, 60_000);
	timer.unref();
	const stopHeartbeat = () => {
		clearInterval(timer);
	};
	const stopSignal = getStopSignal();
	stopSignal.addEventListener("abort", stopHeartbeat, { once: true });
	if (stopSignal.aborted) {
		stopHeartbeat();
	}

	try {
		const targets = await resolveRunTargets(run);
		const requiredEnvironments = new Set(
			targets.map((target) =>
				target.metadata?.source === "airside"
					? "AIRSIDE_GATEWAY_API_KEY"
					: "BENCHMARK_GATEWAY_API_KEY",
			),
		);
		for (const environment of requiredEnvironments) {
			if (!process.env[environment]?.trim()) {
				throw new Error(`${environment} is not configured.`);
			}
		}
		const keyEnvironment = targets.some(
			(target) => target.metadata?.source === "airside",
		)
			? "AIRSIDE_GATEWAY_API_KEY"
			: "BENCHMARK_GATEWAY_API_KEY";
		const apiKey = process.env[keyEnvironment]?.trim();
		if (!apiKey) {
			throw new Error(`${keyEnvironment} is not configured.`);
		}
		let infrastructureError: Error | undefined;
		const profile = getBuiltInProfile(run.profile);
		const result = await execute({
			client: {
				url: `${getGatewayApiBaseUrl()}/chat/completions`,
				apiKey,
			},
			targets,
			fetch: benchmarkGatewayFetch(run, targets, (error) => {
				infrastructureError = error;
			}),
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

		if (infrastructureError) {
			throw infrastructureError;
		}
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
	} finally {
		stopHeartbeat();
		stopSignal.removeEventListener("abort", stopHeartbeat);
		await heartbeat;
	}
	return true;
}
function benchmarkGatewayFetch(
	run: BenchmarkRunRow,
	targets: BenchmarkTarget[],
	onInfrastructureError: (error: Error) => void,
): typeof fetch {
	const identities = new Map<string, string>();
	const rejectConfiguration: (message: string) => never = (message) => {
		const error = new Error(message);
		onInfrastructureError(error);
		throw error;
	};
	const configuration = async <T>(
		operation: () => T | Promise<T>,
		message: string,
	): Promise<T> => {
		try {
			return await operation();
		} catch {
			return rejectConfiguration(message);
		}
	};
	return async (input, init) => {
		if (typeof init?.body !== "string") {
			rejectConfiguration("Benchmark request body is unavailable.");
		}
		const request = await configuration(
			() => JSON.parse(String(init.body)) as ModelVerificationRequest,
			"Benchmark request body is unavailable.",
		);
		const selected = targets.find((target) => target.model === request.model);
		if (!selected) {
			rejectConfiguration("Benchmark target is unavailable.");
		}
		if (selected.metadata?.source !== "airside") {
			const key = process.env.BENCHMARK_GATEWAY_API_KEY?.trim();
			if (!key) {
				rejectConfiguration("BENCHMARK_GATEWAY_API_KEY is not configured.");
			}
			const headers = new Headers(init.headers);
			headers.set("Authorization", `Bearer ${key}`);
			return await fetch(input, { ...init, headers });
		}
		const providerId = selected.metadata.provider;
		const region = selected.metadata.region;
		const externalId = selected.metadata.externalId;
		if (typeof externalId !== "string" || !externalId) {
			rejectConfiguration("Benchmark upstream model is unavailable.");
		}
		if (typeof providerId !== "string") {
			rejectConfiguration("Benchmark provider is unavailable.");
		}
		const mapping = await configuration(
			() =>
				db.query.modelProviderMapping.findFirst({
					where: {
						modelId: { eq: run.modelId },
						providerId: { eq: providerId },
						source: { eq: "airside" },
						externalId: { eq: externalId },
						region:
							typeof region === "string" ? { eq: region } : { isNull: true },
						status: { eq: "active" },
					},
				}),
			"Benchmark mapping is unavailable.",
		);
		const live = mapping
			? await configuration(
					() => liveVerificationMapping(mapping.id),
					"Benchmark listing is unavailable.",
				)
			: null;
		if (!live) {
			rejectConfiguration("Benchmark listing is no longer active.");
		}
		if (
			live.mapping.source !== "airside" ||
			live.target.providerId !== providerId ||
			live.target.modelName !== run.modelId ||
			live.target.externalId !== externalId ||
			(live.target.region ?? null) !==
				(typeof region === "string" ? region : null)
		) {
			rejectConfiguration("Benchmark listing changed during execution.");
		}
		const credentialSource = await configuration(
			() => currentCredentialSource(live),
			"Benchmark credential is unavailable.",
		);
		if (!credentialSource) {
			rejectConfiguration("Benchmark credential is unavailable.");
		}
		const credential = await configuration(
			() =>
				resolveCredential(
					{
						id: run.id,
						modelProviderMappingId: mapping!.id,
						providerCompanyId: live.claim?.providerCompanyId ?? null,
						credentialSource,
						target: live.target,
					},
					false,
				),
			"Benchmark credential is unavailable.",
		);
		const identity = JSON.stringify([
			credential.providerKeyId,
			credential.credentialFingerprint,
			credential.baseUrl,
			credential.providerKeyOptions,
			live.target,
		]);
		if (
			identities.has(selected.id) &&
			identities.get(selected.id) !== identity
		) {
			rejectConfiguration("Benchmark credential changed during execution.");
		}
		identities.set(selected.id, identity);
		const native = await configuration(
			() =>
				prepareProviderModelVerificationRequest(request, {
					target: live.target,
					token: credential.providerKey,
					baseUrl: credential.baseUrl,
					providerKeyOptions: credential.providerKeyOptions,
					skipEnvVars: credential.skipEnvVars,
				}),
			"Benchmark inference configuration is unavailable.",
		);
		if (native.payload instanceof FormData) {
			rejectConfiguration("Benchmark requires a JSON inference request.");
		}
		const pricing = await configuration(
			() => airsideInferencePricing(live.target, live.mapping),
			"Benchmark pricing is unavailable.",
		);
		return await createAirsideGatewayFetch({
			runId: run.id,
			providerKeyId: credential.providerKeyId,
			target: live.target,
			pricing,
			responseFormat: "openai-chat-completions",
			onInfrastructureError,
		})(native.endpoint, {
			...init,
			headers: native.headers,
			body: JSON.stringify(native.payload),
		});
	};
}
