import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { apiKeyScopeFilter } from "@/lib/api-key-scope-filter.js";
import {
	dayKeyField,
	eachDay,
	rangeDaysInclusive,
	resolveDateRange,
} from "@/lib/date-range.js";
import {
	getApiKeyScope,
	getUserProjectIds,
	isKeyScoped,
	userHasOrganizationAccess,
} from "@/utils/authorization.js";
import { createRoute } from "@/utils/create-route.js";
import { bucketDate, timezoneQueryField } from "@/utils/timezone.js";
import {
	isZeroDataRetentionEnabled,
	zdrCachingConflictMessage,
} from "@/utils/zdr-settings.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	apiKeyHourlyStats,
	cdb,
	db,
	gt,
	gte,
	inArray,
	lte,
	projectHourlyStats,
	sql,
	tables,
} from "@llmgateway/db";
import { formatDayKey, shiftDayKey } from "@llmgateway/shared";
import { canManageProject } from "@llmgateway/shared/organization-roles";

import type { ServerTypes } from "@/vars.js";

export const organizationProjects = new OpenAPIHono<ServerTypes>();

const bulkProjectActions = ["update", "delete"] as const;

const bulkProjectFailureMessages = {
	not_found: "Project not found",
	forbidden: "You don't have permission to change this project",
	owner_only: "Only owners can archive projects",
	zdr_caching: zdrCachingConflictMessage,
	coding_plan_routing:
		'Only the "auto" and "price" routing strategies are available on coding plans.',
} as const;
type BulkProjectFailureReason = keyof typeof bulkProjectFailureMessages;

const MAX_BULK_PROJECTS = 200;

const bulkProjectSettingsSchema = z.object({
	mode: z.enum(["api-keys", "credits", "hybrid"]).optional(),
	cachingEnabled: z.boolean().optional(),
	defaultRoutingStrategy: z
		.enum(["auto", "price", "throughput", "latency"])
		.optional(),
});

const bulkProjects = createRoute({
	method: "post",
	path: "/{id}/projects/bulk",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						action: z.enum(bulkProjectActions),
						ids: z.array(z.string().min(1)).min(1).max(MAX_BULK_PROJECTS),
						settings: bulkProjectSettingsSchema.optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						action: z.enum(bulkProjectActions),
						succeeded: z.array(z.string()),
						skipped: z.array(z.string()).openapi({
							description: "Projects already matching the requested settings.",
						}),
						failed: z.array(
							z.object({
								id: z.string(),
								reason: z.enum(
									Object.keys(bulkProjectFailureMessages) as [
										BulkProjectFailureReason,
										...BulkProjectFailureReason[],
									],
								),
								message: z.string(),
							}),
						),
					}),
				},
			},
			description: "Per-project outcome of a bulk settings update or archive.",
		},
	},
});

organizationProjects.openapi(bulkProjects, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const { action, ids, settings } = c.req.valid("json");
	const uniqueIds = [...new Set(ids)];

	const membership = await db.query.userOrganization.findFirst({
		where: { userId: { eq: user.id }, organizationId: { eq: id } },
		with: { organization: true },
	});
	if (!membership?.organization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}
	const organization = membership.organization;

	const changes = Object.fromEntries(
		Object.entries(settings ?? {}).filter(([, value]) => value !== undefined),
	) as z.infer<typeof bulkProjectSettingsSchema>;
	if (action === "update" && !Object.keys(changes).length) {
		throw new HTTPException(400, {
			message: "Choose at least one setting to change",
		});
	}

	const accessibleProjectIds = new Set(await getUserProjectIds(user.id));
	const projects = await db.query.project.findMany({
		where: {
			id: { in: uniqueIds },
			organizationId: { eq: id },
			status: { ne: "deleted" },
		},
	});
	const byId = new Map(projects.map((project) => [project.id, project]));

	const skipped: string[] = [];
	const failed: {
		id: string;
		reason: BulkProjectFailureReason;
		message: string;
	}[] = [];
	const fail = (projectId: string, reason: BulkProjectFailureReason) => {
		failed.push({
			id: projectId,
			reason,
			message: bulkProjectFailureMessages[reason],
		});
	};

	const eligible: (typeof projects)[number][] = [];
	for (const projectId of uniqueIds) {
		const project = byId.get(projectId);
		if (!project || !accessibleProjectIds.has(projectId)) {
			fail(projectId, "not_found");
			continue;
		}
		if (action === "delete") {
			if (membership.role !== "owner") {
				fail(projectId, "owner_only");
				continue;
			}
			eligible.push(project);
			continue;
		}
		if (!canManageProject(membership.role)) {
			fail(projectId, "forbidden");
			continue;
		}
		if (changes.cachingEnabled && isZeroDataRetentionEnabled(organization)) {
			fail(projectId, "zdr_caching");
			continue;
		}
		if (
			changes.defaultRoutingStrategy &&
			organization.kind === "devpass" &&
			organization.devPlan !== "none" &&
			changes.defaultRoutingStrategy !== "auto" &&
			changes.defaultRoutingStrategy !== "price"
		) {
			fail(projectId, "coding_plan_routing");
			continue;
		}
		const unchanged = Object.entries(changes).every(
			([field, value]) => project[field as keyof typeof changes] === value,
		);
		if (unchanged) {
			skipped.push(projectId);
			continue;
		}
		eligible.push(project);
	}

	if (eligible.length) {
		await cdb
			.update(tables.project)
			.set(action === "delete" ? { status: "deleted" } : changes)
			.where(
				inArray(
					tables.project.id,
					eligible.map((project) => project.id),
				),
			);

		await Promise.all(
			eligible.map((project) =>
				logAuditEvent({
					organizationId: id,
					userId: user.id,
					action: action === "delete" ? "project.delete" : "project.update",
					resourceType: "project",
					resourceId: project.id,
					metadata: {
						resourceName: project.name,
						bulk: true,
						...(action === "update" && {
							changes: Object.fromEntries(
								Object.entries(changes)
									.filter(
										([field, value]) =>
											project[field as keyof typeof changes] !== value,
									)
									.map(([field, value]) => [
										field,
										{
											old: project[field as keyof typeof changes],
											new: value,
										},
									]),
							),
						}),
					},
				}),
			),
		);
	}

	return c.json({
		action,
		succeeded: eligible.map((project) => project.id),
		skipped,
		failed,
	});
});

const projectUsageSchema = z.object({
	projectId: z.string(),
	requestCount: z.number(),
	errorCount: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	lastActiveAt: z.string().nullable(),
	apiKeyCount: z.number(),
	daily: z.array(
		z.object({
			date: z.string(),
			requestCount: z.number(),
			cost: z.number(),
		}),
	),
});

// Long ranges fold consecutive days into one trend point so the payload stays
// bounded however wide the picked range is.
const MAX_TREND_POINTS = 90;

// Generous enough for the picker's "All time" preset; only bounds the day loop.
const MAX_RANGE_DAYS = 20 * 366;

const getProjectsUsage = createRoute({
	method: "get",
	path: "/{id}/projects/usage",
	request: {
		params: z.object({
			id: z.string(),
		}),
		query: z.object({
			days: z.enum(["7", "30", "90"]).optional(),
			from: dayKeyField.optional(),
			to: dayKeyField.optional(),
			timezone: timezoneQueryField,
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						days: z.number(),
						from: z.string(),
						to: z.string(),
						projects: z.array(projectUsageSchema),
					}),
				},
			},
			description:
				"Per-project usage, daily trend and last activity for the organization.",
		},
	},
});

organizationProjects.openapi(getProjectsUsage, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const query = c.req.valid("query");
	const timeZone = query.timezone ?? "UTC";
	if (Boolean(query.from) !== Boolean(query.to)) {
		throw new HTTPException(400, {
			message: "from and to must be provided together",
		});
	}
	const toKey = query.to ?? formatDayKey(new Date(), timeZone);
	const fromKey =
		query.from ?? shiftDayKey(toKey, 1 - Number(query.days ?? "30"));
	if (fromKey > toKey) {
		throw new HTTPException(400, { message: "from must not be after to" });
	}
	const { startDate, endDate } = resolveDateRange(fromKey, toKey, timeZone);
	if (rangeDaysInclusive(fromKey, toKey) > MAX_RANGE_DAYS) {
		throw new HTTPException(400, {
			message: `Date range too large (max ${MAX_RANGE_DAYS} days)`,
		});
	}
	const slots = eachDay(fromKey, toKey);
	const days = slots.length;

	if (!(await userHasOrganizationAccess(user.id, id))) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const accessibleProjectIds = new Set(await getUserProjectIds(user.id));
	const orgProjects = await db.query.project.findMany({
		where: {
			organizationId: { eq: id },
			status: { ne: "deleted" },
		},
		columns: { id: true },
	});
	const projectIds = orgProjects
		.map((project) => project.id)
		.filter((projectId) => accessibleProjectIds.has(projectId));

	if (!projectIds.length) {
		return c.json({ days, from: fromKey, to: toKey, projects: [] });
	}

	const scope = await getApiKeyScope(user.id, projectIds);
	const keyScoped = isKeyScoped(scope);

	const stats = keyScoped ? apiKeyHourlyStats : projectHourlyStats;
	const projectFilter = and(
		inArray(stats.projectId, projectIds),
		keyScoped
			? apiKeyScopeFilter(
					scope,
					apiKeyHourlyStats.projectId,
					apiKeyHourlyStats.apiKeyId,
				)
			: undefined,
	);

	const [dailyRows, lastActiveRows, apiKeys] = await Promise.all([
		db
			.select({
				projectId: stats.projectId,
				date: bucketDate(stats.hourTimestamp, timeZone, false).as("date"),
				requestCount: sql<number>`COALESCE(SUM(${stats.requestCount}), 0)`.as(
					"requestCount",
				),
				errorCount: sql<number>`COALESCE(SUM(${stats.errorCount}), 0)`.as(
					"errorCount",
				),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${stats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				cost: sql<number>`COALESCE(SUM(CAST(${stats.cost} AS DOUBLE PRECISION)), 0)`.as(
					"cost",
				),
			})
			.from(stats)
			.where(
				and(
					projectFilter,
					gte(stats.hourTimestamp, startDate),
					lte(stats.hourTimestamp, endDate),
				),
			)
			.groupBy(sql`1, 2`),
		db
			.select({
				projectId: stats.projectId,
				lastActiveAt:
					sql<string>`to_char(MAX(${stats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.as(
						"lastActiveAt",
					),
			})
			.from(stats)
			.where(and(projectFilter, gt(stats.requestCount, 0)))
			.groupBy(stats.projectId),
		db.query.apiKey.findMany({
			where: {
				projectId: { in: projectIds },
				status: { ne: "deleted" },
			},
			columns: { id: true, projectId: true },
		}),
	]);

	const restricted = new Set(scope.restrictedProjectIds);
	const ownKeys = new Set(scope.ownApiKeyIds);
	const apiKeyCounts = new Map<string, number>();
	for (const key of apiKeys) {
		if (restricted.has(key.projectId) && !ownKeys.has(key.id)) {
			continue;
		}
		apiKeyCounts.set(key.projectId, (apiKeyCounts.get(key.projectId) ?? 0) + 1);
	}

	const lastActive = new Map(
		lastActiveRows.map((row) => [row.projectId, row.lastActiveAt]),
	);

	const bucketSize = Math.ceil(days / MAX_TREND_POINTS);
	const trendBuckets: string[][] = [];
	for (let index = 0; index < days; index += bucketSize) {
		trendBuckets.push(slots.slice(index, index + bucketSize));
	}

	const daily = new Map<
		string,
		Map<string, { requestCount: number; cost: number }>
	>();
	const totals = new Map<
		string,
		{
			requestCount: number;
			errorCount: number;
			totalTokens: number;
			cost: number;
		}
	>();
	for (const row of dailyRows) {
		const requestCount = Number(row.requestCount);
		const errorCount = Number(row.errorCount);
		const totalTokens = Number(row.totalTokens);
		const cost = Number(row.cost);
		let byDate = daily.get(row.projectId);
		if (!byDate) {
			byDate = new Map();
			daily.set(row.projectId, byDate);
		}
		byDate.set(row.date, { requestCount, cost });
		const total = totals.get(row.projectId) ?? {
			requestCount: 0,
			errorCount: 0,
			totalTokens: 0,
			cost: 0,
		};
		total.requestCount += requestCount;
		total.errorCount += errorCount;
		total.totalTokens += totalTokens;
		total.cost += cost;
		totals.set(row.projectId, total);
	}

	return c.json({
		days,
		from: fromKey,
		to: toKey,
		projects: projectIds.map((projectId) => {
			const total = totals.get(projectId);
			const byDate = daily.get(projectId);
			return {
				projectId,
				requestCount: total?.requestCount ?? 0,
				errorCount: total?.errorCount ?? 0,
				totalTokens: total?.totalTokens ?? 0,
				cost: total?.cost ?? 0,
				lastActiveAt: lastActive.get(projectId) ?? null,
				apiKeyCount: apiKeyCounts.get(projectId) ?? 0,
				daily: trendBuckets.map((bucket) => {
					let requestCount = 0;
					let cost = 0;
					for (const date of bucket) {
						requestCount += byDate?.get(date)?.requestCount ?? 0;
						cost += byDate?.get(date)?.cost ?? 0;
					}
					return { date: bucket[0], requestCount, cost };
				}),
			};
		}),
	});
});
