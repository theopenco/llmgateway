import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";
import {
	benchmarkGatewayKeyConfigured,
	listBenchmarkModelOptions,
	resolveBenchmarkRunTargets,
} from "@/utils/benchmark-targets.js";

import { and, db, desc, eq, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * Admin-facing entry point for the `@llmgateway/benchmarks` suites. Runs are
 * queued here and executed by the worker, because a single run makes many paid
 * upstream calls and takes minutes. Targets are resolved from the static
 * catalogue *and* `model_provider_mapping`, so an Airside listing that only
 * exists in the database is benchmarkable too.
 */
export const adminBenchmarks = new OpenAPIHono<ServerTypes>();

adminBenchmarks.use("/*", adminMiddleware);

const profileSchema = z.enum(["smoke", "standard", "coding", "load"]);
const sourceSchema = z.enum(["catalogue", "airside"]);
const statusSchema = z.enum([
	"queued",
	"running",
	"completed",
	"failed",
	"canceled",
]);

const mappingOptionSchema = z.object({
	mapping: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	region: z.string().nullable(),
	externalId: z.string(),
	source: sourceSchema,
	deactivated: z.boolean(),
});

const modelOptionSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	family: z.string(),
	source: sourceSchema,
	mappings: z.array(mappingOptionSchema),
});

const runSummarySchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	modelId: z.string(),
	mappings: z.array(z.string()),
	profile: profileSchema,
	budgetMs: z.number(),
	timeoutMs: z.number(),
	runs: z.number().nullable(),
	seed: z.number(),
	status: statusSchema,
	attempts: z.number(),
	error: z.string().nullable(),
	targetCount: z.number(),
	requestedByEmail: z.string().nullable(),
});

const listOptions = createRoute({
	method: "get",
	path: "/benchmarks/options",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							models: z.array(modelOptionSchema),
							profiles: z.array(
								z.object({ name: profileSchema, description: z.string() }),
							),
							gatewayKeyConfigured: z.boolean(),
						})
						.openapi({}),
				},
			},
			description: "Benchmarkable models, their mappings, and the profiles.",
		},
	},
});

adminBenchmarks.openapi(listOptions, async (c) => {
	const models = await listBenchmarkModelOptions();
	return c.json({
		models,
		profiles: [
			{
				name: "smoke" as const,
				description:
					"Fast rotating capability and streaming checks. Cheapest option.",
			},
			{
				name: "standard" as const,
				description:
					"Broad capability, robustness, calibration and performance coverage.",
			},
			{
				name: "coding" as const,
				description:
					"Small coding tasks solved through a multi-turn tool-calling loop.",
			},
			{
				name: "load" as const,
				description: "Input, output, streaming and concurrency sweeps.",
			},
		],
		gatewayKeyConfigured: benchmarkGatewayKeyConfigured(),
	});
});

const createRun = createRoute({
	method: "post",
	path: "/benchmarks/runs",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						modelId: z.string().min(1),
						mappings: z.array(z.string()).default([]),
						profile: profileSchema.default("smoke"),
						budgetMs: z
							.number()
							.int()
							.min(10_000)
							.max(1_800_000)
							.default(120_000),
						timeoutMs: z.number().int().min(5_000).max(600_000).default(60_000),
						runs: z.number().int().min(1).max(20).nullish(),
						seed: z.number().int().min(0).default(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: runSummarySchema.openapi({}) } },
			description: "The queued benchmark run.",
		},
	},
});

adminBenchmarks.openapi(createRun, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");

	if (!benchmarkGatewayKeyConfigured()) {
		throw new HTTPException(400, {
			message:
				"BENCHMARK_GATEWAY_API_KEY is not configured, so benchmark runs cannot reach the gateway.",
		});
	}

	// Resolving here rather than in the worker means an unknown model or a
	// mapping selector that matches nothing is rejected while the admin is
	// still looking at the form, instead of failing a queued run minutes later.
	const targets = await resolveBenchmarkRunTargets(body.modelId, body.mappings);

	const [run] = await db
		.insert(tables.benchmarkRun)
		.values({
			requestedBy: user?.id ?? null,
			modelId: body.modelId,
			mappings: body.mappings,
			profile: body.profile,
			budgetMs: body.budgetMs,
			timeoutMs: body.timeoutMs,
			runs: body.runs ?? null,
			seed: body.seed,
			targets: targets.map((target) => ({
				targetId: target.id,
				displayName: target.displayName ?? target.id,
				mapping: target.mapping ?? target.id,
				source:
					target.metadata?.source === "airside"
						? ("airside" as const)
						: ("catalogue" as const),
			})),
		})
		.returning();

	return c.json(serializeRun(run, user?.email ?? null));
});

type BenchmarkRunRow = typeof tables.benchmarkRun.$inferSelect;

function serializeRun(
	run: BenchmarkRunRow,
	requestedByEmail: string | null,
): z.infer<typeof runSummarySchema> {
	return {
		id: run.id,
		createdAt: run.createdAt.toISOString(),
		startedAt: run.startedAt?.toISOString() ?? null,
		completedAt: run.completedAt?.toISOString() ?? null,
		modelId: run.modelId,
		mappings: run.mappings,
		profile: run.profile,
		budgetMs: run.budgetMs,
		timeoutMs: run.timeoutMs,
		runs: run.runs,
		seed: run.seed,
		status: run.status,
		attempts: run.attempts,
		error: run.error,
		targetCount: run.targets?.length ?? 0,
		requestedByEmail,
	};
}

const listRuns = createRoute({
	method: "get",
	path: "/benchmarks/runs",
	request: {
		query: z.object({
			status: statusSchema.optional(),
			modelId: z.string().optional(),
			limit: z.coerce.number().int().min(1).max(100).default(50),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ runs: z.array(runSummarySchema) }).openapi({}),
				},
			},
			description: "Recent benchmark runs, newest first.",
		},
	},
});

adminBenchmarks.openapi(listRuns, async (c) => {
	const { status, modelId, limit } = c.req.valid("query");
	const filters = [
		status ? eq(tables.benchmarkRun.status, status) : undefined,
		modelId ? eq(tables.benchmarkRun.modelId, modelId) : undefined,
	].filter((filter) => filter !== undefined);

	const rows = await db
		.select({ run: tables.benchmarkRun, email: tables.user.email })
		.from(tables.benchmarkRun)
		.leftJoin(tables.user, eq(tables.user.id, tables.benchmarkRun.requestedBy))
		.where(filters.length > 0 ? and(...filters) : undefined)
		.orderBy(desc(tables.benchmarkRun.createdAt))
		.limit(limit);

	return c.json({
		runs: rows.map((row) => serializeRun(row.run, row.email ?? null)),
	});
});

const getRun = createRoute({
	method: "get",
	path: "/benchmarks/runs/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							run: runSummarySchema,
							targets: z.array(
								z.object({
									targetId: z.string(),
									displayName: z.string(),
									mapping: z.string(),
									source: sourceSchema,
								}),
							),
							result: z.record(z.string(), z.unknown()).nullable(),
						})
						.openapi({}),
				},
			},
			description: "One benchmark run and its rendered result.",
		},
	},
});

adminBenchmarks.openapi(getRun, async (c) => {
	const { id } = c.req.valid("param");
	const [row] = await db
		.select({ run: tables.benchmarkRun, email: tables.user.email })
		.from(tables.benchmarkRun)
		.leftJoin(tables.user, eq(tables.user.id, tables.benchmarkRun.requestedBy))
		.where(eq(tables.benchmarkRun.id, id))
		.limit(1);

	if (!row) {
		throw new HTTPException(404, { message: "Benchmark run not found" });
	}

	return c.json({
		run: serializeRun(row.run, row.email ?? null),
		targets: row.run.targets ?? [],
		result: row.run.result ?? null,
	});
});

const cancelRun = createRoute({
	method: "post",
	path: "/benchmarks/runs/{id}/cancel",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ run: runSummarySchema }).openapi({}),
				},
			},
			description: "The canceled benchmark run.",
		},
	},
});

adminBenchmarks.openapi(cancelRun, async (c) => {
	const { id } = c.req.valid("param");
	// Only a run the worker has not claimed can be canceled; a running one owns
	// in-flight upstream requests that are already being paid for.
	const [canceled] = await db
		.update(tables.benchmarkRun)
		.set({ status: "canceled", completedAt: new Date() })
		.where(
			and(
				eq(tables.benchmarkRun.id, id),
				eq(tables.benchmarkRun.status, "queued"),
			),
		)
		.returning();

	if (!canceled) {
		throw new HTTPException(409, {
			message: "Only a queued benchmark run can be canceled",
		});
	}

	return c.json({ run: serializeRun(canceled, null) });
});
