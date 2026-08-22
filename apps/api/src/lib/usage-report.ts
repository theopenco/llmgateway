import { z } from "zod";

import {
	apiKeyAnalyticsId,
	PLAYGROUND_ANALYTICS_KEY,
	PLAYGROUND_ANALYTICS_LABEL,
} from "@/lib/api-key-analytics.js";
import {
	mapModeSplit,
	modeSplitFields,
	modeSplitSchema,
} from "@/lib/mode-split.js";
import { bucketDate } from "@/utils/timezone.js";

import {
	and,
	apiKeyHourlyModelStats,
	db,
	eq,
	gte,
	inArray,
	lte,
	sql,
	tables,
} from "@llmgateway/db";

export const USAGE_DIMENSIONS = [
	"user",
	"model",
	"provider",
	"project",
	"apiKey",
] as const;
export type UsageDimension = (typeof USAGE_DIMENSIONS)[number];

export const USAGE_GRANULARITIES = ["hour", "day", "total"] as const;
export type UsageGranularity = (typeof USAGE_GRANULARITIES)[number];

export const usageReportRowSchema = z.object({
	// null when granularity is "total"; otherwise a wall-clock bucket label in
	// the requested timezone ("YYYY-MM-DD" or "YYYY-MM-DDTHH:mm:ss").
	date: z.string().nullable(),
	// Dimension fields are null unless the dimension was requested in groupBy,
	// so the row shape stays stable for schema-driven consumers.
	userId: z.string().nullable(),
	userName: z.string().nullable(),
	userEmail: z.string().nullable(),
	projectId: z.string().nullable(),
	projectName: z.string().nullable(),
	apiKeyId: z.string().nullable(),
	apiKeyName: z.string().nullable(),
	model: z.string().nullable(),
	provider: z.string().nullable(),
	requestCount: z.number(),
	errorCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cachedTokens: z.number(),
	reasoningTokens: z.number(),
	cost: z.number(),
	inputCost: z.number(),
	outputCost: z.number(),
	...modeSplitSchema,
});

export type UsageReportRow = z.infer<typeof usageReportRowSchema>;

export interface UsageReportOptions {
	/** Non-deleted project ids of the organization, already narrowed by any projectId filter. */
	projectIds: string[];
	startDate: Date;
	endDate: Date;
	timeZone: string;
	granularity: UsageGranularity;
	dimensions: UsageDimension[];
	userId?: string;
	apiKeyId?: string;
	limit: number;
	offset: number;
}

export interface UsageReportResult {
	rows: UsageReportRow[];
	hasMore: boolean;
}

/**
 * Composable usage/cost cross-tab over the per-api-key hourly model rollups.
 *
 * Requests are attributed to whoever created the api key that made them
 * (`api_key.created_by`) — the log table has no user column, so this join is the
 * only link between traffic and a person. `end_user_customer` keys are included
 * deliberately: their creator is the member who provisioned the platform key.
 * Both rules mirror `getUserUsageBreakdown` so the master API and the dashboard
 * can never report different numbers for the same window.
 */
export async function getUsageReport(
	options: UsageReportOptions,
): Promise<UsageReportResult> {
	const {
		projectIds,
		startDate,
		endDate,
		timeZone,
		granularity,
		dimensions,
		userId,
		apiKeyId,
		limit,
		offset,
	} = options;

	if (!projectIds.length) {
		return { rows: [], hasMore: false };
	}

	const wanted = new Set(dimensions);
	const nullText = sql<string | null>`NULL::text`;

	// Grouped expressions are referenced by SELECT position, because bucketDate
	// binds the timezone as a parameter and repeating the expression in GROUP BY
	// would make the two differ. Non-grouped dimensions select a NULL constant,
	// which Postgres allows without a GROUP BY entry. Keep this list and the
	// selection object in the same order.
	const groupPositions: number[] = [];
	if (granularity !== "total") {
		groupPositions.push(1);
	}
	const dimensionPositions: Record<UsageDimension, number> = {
		user: 2,
		model: 3,
		provider: 4,
		project: 5,
		apiKey: 6,
	};
	for (const dimension of USAGE_DIMENSIONS) {
		if (wanted.has(dimension)) {
			groupPositions.push(dimensionPositions[dimension]);
		}
	}

	const selection = {
		date:
			granularity === "total"
				? nullText
				: bucketDate(
						apiKeyHourlyModelStats.hourTimestamp,
						timeZone,
						granularity === "hour",
					),
		userId: wanted.has("user") ? tables.apiKey.createdBy : nullText,
		model: wanted.has("model") ? apiKeyHourlyModelStats.usedModel : nullText,
		provider: wanted.has("provider")
			? apiKeyHourlyModelStats.usedProvider
			: nullText,
		projectId: wanted.has("project")
			? apiKeyHourlyModelStats.projectId
			: nullText,
		apiKeyId: wanted.has("apiKey")
			? apiKeyAnalyticsId(apiKeyHourlyModelStats.apiKeyId, tables.apiKey.kind)
			: nullText,
		requestCount:
			sql<number>`COALESCE(SUM(${apiKeyHourlyModelStats.requestCount}), 0)`.as(
				"requestCount",
			),
		errorCount:
			sql<number>`COALESCE(SUM(${apiKeyHourlyModelStats.errorCount}), 0)`.as(
				"errorCount",
			),
		inputTokens:
			sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.inputTokens} AS NUMERIC)), 0)`.as(
				"inputTokens",
			),
		outputTokens:
			sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.outputTokens} AS NUMERIC)), 0)`.as(
				"outputTokens",
			),
		totalTokens:
			sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
				"totalTokens",
			),
		cachedTokens:
			sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.cachedTokens} AS NUMERIC)), 0)`.as(
				"cachedTokens",
			),
		reasoningTokens:
			sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.reasoningTokens} AS NUMERIC)), 0)`.as(
				"reasoningTokens",
			),
		cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyModelStats.cost} as double precision)), 0)`.as(
			"cost",
		),
		inputCost:
			sql<number>`COALESCE(SUM(cast(${apiKeyHourlyModelStats.inputCost} as double precision)), 0)`.as(
				"inputCost",
			),
		outputCost:
			sql<number>`COALESCE(SUM(cast(${apiKeyHourlyModelStats.outputCost} as double precision)), 0)`.as(
				"outputCost",
			),
		...modeSplitFields(apiKeyHourlyModelStats),
	};

	const filters = [
		inArray(apiKeyHourlyModelStats.projectId, projectIds),
		inArray(tables.apiKey.keyType, ["user", "end_user_customer"] as const),
		gte(apiKeyHourlyModelStats.hourTimestamp, startDate),
		lte(apiKeyHourlyModelStats.hourTimestamp, endDate),
	];
	if (userId) {
		filters.push(eq(tables.apiKey.createdBy, userId));
	}
	if (apiKeyId) {
		filters.push(eq(apiKeyHourlyModelStats.apiKeyId, apiKeyId));
	}

	let query = db
		.select(selection)
		.from(apiKeyHourlyModelStats)
		.innerJoin(
			tables.apiKey,
			eq(tables.apiKey.id, apiKeyHourlyModelStats.apiKeyId),
		)
		.where(and(...filters))
		.$dynamic();

	if (groupPositions.length) {
		const positions = sql.raw(groupPositions.join(", "));
		query = query.groupBy(positions).orderBy(sql`${positions}`);
	}

	// One extra row tells us whether another page exists without a count query.
	const raw = await query.limit(limit + 1).offset(offset);
	const hasMore = raw.length > limit;
	const page = hasMore ? raw.slice(0, limit) : raw;

	const [userLabels, projectLabels, apiKeyLabels] = await Promise.all([
		wanted.has("user")
			? loadUserLabels(collectIds(page, "userId"))
			: Promise.resolve(new Map<string, { name: string; email: string }>()),
		wanted.has("project")
			? loadProjectNames(collectIds(page, "projectId"))
			: Promise.resolve(new Map<string, string>()),
		wanted.has("apiKey")
			? loadApiKeyNames(collectIds(page, "apiKeyId"))
			: Promise.resolve(new Map<string, string>()),
	]);

	const rows = page.map((row): UsageReportRow => {
		const user = row.userId ? userLabels.get(row.userId) : undefined;
		return {
			date: row.date === null ? null : String(row.date),
			userId: row.userId,
			userName: row.userId ? (user?.name ?? "Unknown user") : null,
			userEmail: row.userId ? (user?.email ?? null) : null,
			projectId: row.projectId,
			projectName: row.projectId
				? (projectLabels.get(row.projectId) ?? null)
				: null,
			apiKeyId: row.apiKeyId,
			apiKeyName: row.apiKeyId
				? (apiKeyLabels.get(row.apiKeyId) ?? null)
				: null,
			model: row.model,
			provider: row.provider,
			requestCount: Number(row.requestCount ?? 0),
			errorCount: Number(row.errorCount ?? 0),
			inputTokens: Number(row.inputTokens ?? 0),
			outputTokens: Number(row.outputTokens ?? 0),
			totalTokens: Number(row.totalTokens ?? 0),
			cachedTokens: Number(row.cachedTokens ?? 0),
			reasoningTokens: Number(row.reasoningTokens ?? 0),
			cost: Number(row.cost ?? 0),
			inputCost: Number(row.inputCost ?? 0),
			outputCost: Number(row.outputCost ?? 0),
			...mapModeSplit(row),
		};
	});

	return { rows, hasMore };
}

function collectIds(
	rows: {
		userId: string | null;
		projectId: string | null;
		apiKeyId: string | null;
	}[],
	field: "userId" | "projectId" | "apiKeyId",
): string[] {
	const ids = new Set<string>();
	for (const row of rows) {
		const value = row[field];
		if (value) {
			ids.add(value);
		}
	}
	return Array.from(ids);
}

async function loadUserLabels(ids: string[]) {
	const labels = new Map<string, { name: string; email: string }>();
	if (!ids.length) {
		return labels;
	}
	const rows = await db
		.select({
			id: tables.user.id,
			name: tables.user.name,
			email: tables.user.email,
		})
		.from(tables.user)
		.where(inArray(tables.user.id, ids));
	for (const row of rows) {
		labels.set(row.id, { name: row.name ?? row.email, email: row.email });
	}
	return labels;
}

async function loadProjectNames(ids: string[]) {
	const names = new Map<string, string>();
	if (!ids.length) {
		return names;
	}
	const rows = await db
		.select({ id: tables.project.id, name: tables.project.name })
		.from(tables.project)
		.where(inArray(tables.project.id, ids));
	for (const row of rows) {
		names.set(row.id, row.name);
	}
	return names;
}

async function loadApiKeyNames(ids: string[]) {
	const names = new Map<string, string>();
	if (!ids.length) {
		return names;
	}
	const storedIds = ids.filter((id) => id !== PLAYGROUND_ANALYTICS_KEY);
	if (ids.includes(PLAYGROUND_ANALYTICS_KEY)) {
		names.set(PLAYGROUND_ANALYTICS_KEY, PLAYGROUND_ANALYTICS_LABEL);
	}
	if (!storedIds.length) {
		return names;
	}
	const rows = await db
		.select({
			id: tables.apiKey.id,
			description: tables.apiKey.description,
		})
		.from(tables.apiKey)
		.where(inArray(tables.apiKey.id, storedIds));
	for (const row of rows) {
		names.set(row.id, row.description);
	}
	return names;
}

const CSV_COLUMNS = [
	"date",
	"userId",
	"userName",
	"userEmail",
	"projectId",
	"projectName",
	"apiKeyId",
	"apiKeyName",
	"model",
	"provider",
	"requestCount",
	"errorCount",
	"inputTokens",
	"outputTokens",
	"totalTokens",
	"cachedTokens",
	"reasoningTokens",
	"cost",
	"inputCost",
	"outputCost",
	"creditsRequestCount",
	"apiKeysRequestCount",
	"creditsCost",
	"apiKeysCost",
] as const satisfies readonly (keyof UsageReportRow)[];

function csvCell(value: string | number | null): string {
	if (value === null) {
		return "";
	}
	const text = String(value);
	return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Flat CSV rendering of the report, with a fixed column set so a scheduled
 * export keeps the same header regardless of which dimensions were requested.
 */
export function usageReportToCsv(rows: UsageReportRow[]): string {
	const lines = [CSV_COLUMNS.join(",")];
	for (const row of rows) {
		lines.push(CSV_COLUMNS.map((column) => csvCell(row[column])).join(","));
	}
	return lines.join("\n") + "\n";
}
