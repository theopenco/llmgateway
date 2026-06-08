import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { invalidateSwrByTables } from "@llmgateway/cache";
import { db, eq, getTableName, tables } from "@llmgateway/db";
import {
	buildProviderPriorityDefaults,
	DEFAULT_ROUTING_HISTORY,
	DEFAULT_ROUTING_RETRY,
	DEFAULT_ROUTING_SESSION,
	DEFAULT_ROUTING_STICKY,
	DEFAULT_ROUTING_THRESHOLDS,
	DEFAULT_ROUTING_TIMEOUTS,
	DEFAULT_ROUTING_WEIGHTS,
	resolveRoutingConfig,
	ROUTING_HISTORY_MAX_WINDOW_MINUTES,
} from "@llmgateway/shared/routing-config";

import type { ServerTypes } from "@/vars.js";
import type {
	ProviderPriorityOverrides,
	RoutingHistoryConfig,
	RoutingRetryConfig,
	RoutingSessionConfig,
	RoutingStickyConfig,
	RoutingThresholdsConfig,
	RoutingTimeoutsConfig,
	RoutingWeightsConfig,
} from "@llmgateway/db";

export const routingConfig = new OpenAPIHono<ServerTypes>();

const routingConfigTableName = getTableName(tables.routingConfig);

async function invalidateRoutingConfigCache(): Promise<void> {
	await invalidateSwrByTables([routingConfigTableName]);
}

async function checkProjectEnterpriseAccess(
	userId: string,
	projectId: string,
): Promise<{
	project: { id: string; organizationId: string };
}> {
	const project = await db.query.project.findFirst({
		where: { id: { eq: projectId } },
	});

	if (!project) {
		throw new HTTPException(404, { message: "Project not found" });
	}

	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: project.organizationId },
		},
		with: {
			organization: true,
		},
	});

	if (!userOrg) {
		throw new HTTPException(403, {
			message: "You do not have access to this project",
		});
	}

	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can manage routing configuration",
		});
	}

	if (userOrg.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Routing configuration requires an enterprise plan",
		});
	}

	return {
		project: { id: project.id, organizationId: project.organizationId },
	};
}

const weightsSchema = z
	.object({
		price: z.number().min(0).optional(),
		imagePrice: z.number().min(0).optional(),
		uptime: z.number().min(0).optional(),
		throughput: z.number().min(0).optional(),
		latency: z.number().min(0).optional(),
		cache: z.number().min(0).optional(),
	})
	.strict();

const thresholdsSchema = z
	.object({
		cachePromptTokens: z.number().int().min(0).optional(),
		uptimePenalty: z.number().min(0).max(100).optional(),
		defaultUptime: z.number().min(0).max(100).optional(),
		defaultLatency: z.number().min(0).optional(),
		defaultThroughput: z.number().min(0).optional(),
		explorationRate: z.number().min(0).max(1).optional(),
	})
	.strict();

const retrySchema = z
	.object({
		maxRetries: z.number().int().min(0).max(10).optional(),
		lowUptimeFallbackThreshold: z.number().min(0).max(100).optional(),
	})
	.strict();

// The built-in defaults are also the infra ceiling — upstream proxies /
// load balancers enforce these as hard caps, so a project override only
// makes sense as a *shorter* timeout.
const timeoutsSchema = z
	.object({
		gatewayMs: z
			.number()
			.int()
			.min(1000)
			.max(DEFAULT_ROUTING_TIMEOUTS.gatewayMs)
			.optional(),
		streamingMs: z
			.number()
			.int()
			.min(1000)
			.max(DEFAULT_ROUTING_TIMEOUTS.streamingMs)
			.optional(),
		plainMs: z
			.number()
			.int()
			.min(1000)
			.max(DEFAULT_ROUTING_TIMEOUTS.plainMs)
			.optional(),
	})
	.strict();

const historySchema = z
	.object({
		windowMinutes: z
			.number()
			.int()
			.min(1)
			.max(ROUTING_HISTORY_MAX_WINDOW_MINUTES)
			.optional(),
		tier1Minutes: z.number().int().min(0).optional(),
		tier2Minutes: z.number().int().min(0).optional(),
		tier1Weight: z.number().min(0).optional(),
		tier2Weight: z.number().min(0).optional(),
		tier3Weight: z.number().min(0).optional(),
	})
	.strict();

const stickySchema = z
	.object({
		enabled: z.boolean().optional(),
		ttlSeconds: z.number().int().min(1).max(86_400).optional(),
		uptimeThreshold: z.number().min(0).max(100).optional(),
		scoreMargin: z.number().min(0).max(10).optional(),
	})
	.strict();

const sessionSchema = z
	.object({
		enabled: z.boolean().optional(),
		ttlSeconds: z.number().int().min(1).max(86_400).optional(),
		uptimeThreshold: z.number().min(0).max(100).optional(),
	})
	.strict();

const providerPrioritiesSchema = z.record(z.string(), z.number().min(0).max(1));

const routingConfigRowSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	enabled: z.boolean(),
	weights: weightsSchema.nullable(),
	thresholds: thresholdsSchema.nullable(),
	retry: retrySchema.nullable(),
	timeouts: timeoutsSchema.nullable(),
	history: historySchema.nullable(),
	sticky: stickySchema.nullable(),
	session: sessionSchema.nullable(),
	providerPriorities: providerPrioritiesSchema.nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const updateBodySchema = z.object({
	enabled: z.boolean().optional(),
	weights: weightsSchema.nullable().optional(),
	thresholds: thresholdsSchema.nullable().optional(),
	retry: retrySchema.nullable().optional(),
	timeouts: timeoutsSchema.nullable().optional(),
	history: historySchema.nullable().optional(),
	sticky: stickySchema.nullable().optional(),
	session: sessionSchema.nullable().optional(),
	providerPriorities: providerPrioritiesSchema.nullable().optional(),
});

const resolvedConfigSchema = z.object({
	weights: z.object({
		price: z.number(),
		imagePrice: z.number(),
		uptime: z.number(),
		throughput: z.number(),
		latency: z.number(),
		cache: z.number(),
	}),
	thresholds: z.object({
		cachePromptTokens: z.number(),
		uptimePenalty: z.number(),
		defaultUptime: z.number(),
		defaultLatency: z.number(),
		defaultThroughput: z.number(),
		explorationRate: z.number(),
	}),
	retry: z.object({
		maxRetries: z.number(),
		lowUptimeFallbackThreshold: z.number(),
	}),
	timeouts: z.object({
		gatewayMs: z.number().optional(),
		streamingMs: z.number().optional(),
		plainMs: z.number().optional(),
	}),
	history: z.object({
		windowMinutes: z.number(),
		tier1Minutes: z.number(),
		tier2Minutes: z.number(),
		tier1Weight: z.number(),
		tier2Weight: z.number(),
		tier3Weight: z.number(),
	}),
	sticky: z.object({
		enabled: z.boolean(),
		ttlSeconds: z.number(),
		uptimeThreshold: z.number(),
		scoreMargin: z.number(),
	}),
	session: z.object({
		enabled: z.boolean(),
		ttlSeconds: z.number(),
		uptimeThreshold: z.number(),
	}),
	providerPriorities: z.record(z.string(), z.number()),
});

const getConfig = createRoute({
	method: "get",
	path: "/config/{projectId}",
	request: { params: z.object({ projectId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: routingConfigRowSchema.nullable() },
			},
			description: "Routing configuration row or null",
		},
	},
});

routingConfig.openapi(getConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);

	const row = await db.query.routingConfig.findFirst({
		where: { projectId: { eq: projectId } },
	});

	return c.json(row ?? null);
});

const updateConfig = createRoute({
	method: "put",
	path: "/config/{projectId}",
	request: {
		params: z.object({ projectId: z.string() }),
		body: {
			content: { "application/json": { schema: updateBodySchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: routingConfigRowSchema },
			},
			description: "Updated routing configuration",
		},
	},
});

routingConfig.openapi(updateConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);
	const body = c.req.valid("json");

	// Build the conflict-update payload so that fields omitted from the body
	// preserve their existing values (matching the previous read-then-write
	// semantics). Atomic upsert avoids the unique-violation race on concurrent
	// PUTs that would otherwise both insert.
	const conflictSet: Record<string, unknown> = {};
	if (body.enabled !== undefined) {
		conflictSet.enabled = body.enabled;
	}
	if (body.weights !== undefined) {
		conflictSet.weights = body.weights as RoutingWeightsConfig | null;
	}
	if (body.thresholds !== undefined) {
		conflictSet.thresholds = body.thresholds as RoutingThresholdsConfig | null;
	}
	if (body.retry !== undefined) {
		conflictSet.retry = body.retry as RoutingRetryConfig | null;
	}
	if (body.timeouts !== undefined) {
		conflictSet.timeouts = body.timeouts as RoutingTimeoutsConfig | null;
	}
	if (body.history !== undefined) {
		conflictSet.history = body.history as RoutingHistoryConfig | null;
	}
	if (body.sticky !== undefined) {
		conflictSet.sticky = body.sticky as RoutingStickyConfig | null;
	}
	if (body.session !== undefined) {
		conflictSet.session = body.session as RoutingSessionConfig | null;
	}
	if (body.providerPriorities !== undefined) {
		conflictSet.providerPriorities =
			body.providerPriorities as ProviderPriorityOverrides | null;
	}

	const insertValues = {
		projectId,
		enabled: body.enabled ?? false,
		weights: (body.weights ?? null) as RoutingWeightsConfig | null,
		thresholds: (body.thresholds ?? null) as RoutingThresholdsConfig | null,
		retry: (body.retry ?? null) as RoutingRetryConfig | null,
		timeouts: (body.timeouts ?? null) as RoutingTimeoutsConfig | null,
		history: (body.history ?? null) as RoutingHistoryConfig | null,
		sticky: (body.sticky ?? null) as RoutingStickyConfig | null,
		session: (body.session ?? null) as RoutingSessionConfig | null,
		providerPriorities: (body.providerPriorities ??
			null) as ProviderPriorityOverrides | null,
	};

	const builder = db.insert(tables.routingConfig).values(insertValues);
	const [row] =
		Object.keys(conflictSet).length === 0
			? await builder
					.onConflictDoNothing({ target: tables.routingConfig.projectId })
					.returning()
			: await builder
					.onConflictDoUpdate({
						target: tables.routingConfig.projectId,
						set: conflictSet,
					})
					.returning();

	// When the body had no overrides AND a row already exists,
	// onConflictDoNothing skips and .returning() yields no rows. Fall back to
	// the current row so the response shape stays the same.
	const result =
		row ??
		(await db.query.routingConfig.findFirst({
			where: { projectId: { eq: projectId } },
		}));

	await invalidateRoutingConfigCache();
	return c.json(result);
});

const resetConfig = createRoute({
	method: "post",
	path: "/config/{projectId}/reset",
	request: { params: z.object({ projectId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ ok: z.boolean() }) },
			},
			description: "Reset to defaults",
		},
	},
});

routingConfig.openapi(resetConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);

	await db
		.delete(tables.routingConfig)
		.where(eq(tables.routingConfig.projectId, projectId));

	await invalidateRoutingConfigCache();
	return c.json({ ok: true });
});

const getResolved = createRoute({
	method: "get",
	path: "/config/{projectId}/resolved",
	request: { params: z.object({ projectId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: resolvedConfigSchema },
			},
			description: "Resolved routing configuration with defaults applied",
		},
	},
});

routingConfig.openapi(getResolved, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);

	const row = await db.query.routingConfig.findFirst({
		where: { projectId: { eq: projectId } },
	});

	const resolved = resolveRoutingConfig(
		row
			? {
					enabled: row.enabled,
					weights: row.weights ?? null,
					thresholds: row.thresholds ?? null,
					retry: row.retry ?? null,
					timeouts: row.timeouts ?? null,
					history: row.history ?? null,
					sticky: row.sticky ?? null,
					session: row.session ?? null,
					providerPriorities: row.providerPriorities ?? null,
				}
			: null,
		buildProviderPriorityDefaults(),
	);

	return c.json(resolved);
});

const getDefaults = createRoute({
	method: "get",
	path: "/config/{projectId}/defaults",
	request: { params: z.object({ projectId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						weights: z.object({
							price: z.number(),
							imagePrice: z.number(),
							uptime: z.number(),
							throughput: z.number(),
							latency: z.number(),
							cache: z.number(),
						}),
						thresholds: z.object({
							cachePromptTokens: z.number(),
							uptimePenalty: z.number(),
							defaultUptime: z.number(),
							defaultLatency: z.number(),
							defaultThroughput: z.number(),
							explorationRate: z.number(),
						}),
						retry: z.object({
							maxRetries: z.number(),
							lowUptimeFallbackThreshold: z.number(),
						}),
						timeouts: z.object({
							gatewayMs: z.number(),
							streamingMs: z.number(),
							plainMs: z.number(),
						}),
						history: z.object({
							windowMinutes: z.number(),
							tier1Minutes: z.number(),
							tier2Minutes: z.number(),
							tier1Weight: z.number(),
							tier2Weight: z.number(),
							tier3Weight: z.number(),
						}),
						sticky: z.object({
							enabled: z.boolean(),
							ttlSeconds: z.number(),
							uptimeThreshold: z.number(),
							scoreMargin: z.number(),
						}),
						session: z.object({
							enabled: z.boolean(),
							ttlSeconds: z.number(),
							uptimeThreshold: z.number(),
						}),
						providerPriorities: z.record(z.string(), z.number()),
					}),
				},
			},
			description: "Default routing configuration values",
		},
	},
});

routingConfig.openapi(getDefaults, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);

	return c.json({
		weights: DEFAULT_ROUTING_WEIGHTS,
		thresholds: DEFAULT_ROUTING_THRESHOLDS,
		retry: DEFAULT_ROUTING_RETRY,
		timeouts: DEFAULT_ROUTING_TIMEOUTS,
		history: DEFAULT_ROUTING_HISTORY,
		sticky: DEFAULT_ROUTING_STICKY,
		session: DEFAULT_ROUTING_SESSION,
		providerPriorities: buildProviderPriorityDefaults(),
	});
});
