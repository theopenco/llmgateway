import { z } from "zod";

const periodFields = {
	from: z
		.string()
		.date()
		.optional()
		.describe(
			"First UTC date, YYYY-MM-DD (inclusive). Defaults to 29 days before to.",
		),
	to: z
		.string()
		.date()
		.optional()
		.describe(
			"Last UTC date, YYYY-MM-DD (inclusive). Defaults to today. Maximum range: 366 days.",
		),
};

export const mcpUsageInputSchema = z
	.object({
		...periodFields,
		granularity: z
			.enum(["day", "hour"])
			.default("day")
			.describe("Time series interval. Hourly reports allow at most 31 days."),
	})
	.strict();

export const mcpUsageBreakdownInputSchema = z
	.object({
		...periodFields,
		group_by: z
			.enum(["provider", "model", "app", "api_key"])
			.describe(
				"Rank actual providers, models, coding agents/apps, or API keys.",
			),
		sort_by: z.enum(["requests", "cost", "tokens"]).default("requests"),
		limit: z.number().int().min(1).max(100).default(10),
		offset: z.number().int().min(0).max(10000).default(0),
	})
	.strict();

export const mcpUsageScopeSchema = z.object({
	type: z.enum(["project", "member"]),
	projectId: z.string(),
	userId: z.string().nullable(),
});

export const mcpAccountSchema = z.object({
	user: z.object({ id: z.string(), name: z.string().nullable() }),
	organization: z.object({
		id: z.string(),
		name: z.string(),
		kind: z.string(),
	}),
	project: z.object({ id: z.string(), name: z.string() }),
	role: z.enum(["owner", "admin", "developer"]),
	usageScope: mcpUsageScopeSchema,
	apiKey: z.object({
		id: z.string(),
		name: z.string(),
		usageUsd: z.number(),
		usageLimitUsd: z.number().nullable(),
		periodUsageUsd: z.number(),
		periodUsageLimitUsd: z.number().nullable(),
		periodStartedAt: z.string().nullable(),
		expiresAt: z.string().nullable(),
	}),
	creditsBalanceUsd: z
		.number()
		.nullable()
		.describe(
			"Organization credit balance; null for developers. This is not a usage total or a DevPass plan allowance.",
		),
});

export const mcpUsageMetricsSchema = z.object({
	requestCount: z.number(),
	errorCount: z.number(),
	cacheCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	reasoningTokens: z.number(),
	cachedTokens: z.number(),
	costUsd: z
		.number()
		.describe(
			"Inference cost, including credits and BYOK. Not an invoice total.",
		),
	dataStorageCostUsd: z.number(),
	creditsCostUsd: z.number(),
	byokCostUsd: z
		.number()
		.describe(
			"Provider cost for requests using your own provider keys, billed by the provider.",
		),
	discountSavingsUsd: z.number(),
});

const reportFields = {
	scope: mcpUsageScopeSchema,
	from: z.string(),
	to: z.string(),
	timezone: z.literal("UTC"),
	currency: z.literal("USD"),
	updatedAt: z.string().nullable(),
};

const rankingSchema = mcpUsageMetricsSchema.extend({
	id: z.string(),
	name: z.string(),
});

export const mcpUsageSchema = z.object({
	...reportFields,
	granularity: z.enum(["day", "hour"]),
	totals: mcpUsageMetricsSchema,
	series: z.array(mcpUsageMetricsSchema.extend({ date: z.string() })),
	mostUsedProvider: rankingSchema.nullable(),
	mostUsedModel: rankingSchema.nullable(),
	mostUsedApp: rankingSchema.nullable(),
	appUsageCoverage: z.object({
		requestCount: z.number(),
		totalRequestCount: z.number(),
		complete: z.boolean(),
	}),
});

export const mcpUsageBreakdownSchema = z.object({
	...reportFields,
	groupBy: mcpUsageBreakdownInputSchema.shape.group_by,
	sortBy: mcpUsageBreakdownInputSchema.shape.sort_by,
	rows: z.array(rankingSchema),
	pagination: z.object({
		limit: z.number(),
		offset: z.number(),
		hasMore: z.boolean(),
	}),
	coverage: z.object({
		requestCount: z.number(),
		totalRequestCount: z.number(),
		complete: z.boolean(),
	}),
});

export type McpUsageInput = z.infer<typeof mcpUsageInputSchema>;
export type McpUsageBreakdownInput = z.infer<
	typeof mcpUsageBreakdownInputSchema
>;
export type McpUsageScope = z.infer<typeof mcpUsageScopeSchema>;
