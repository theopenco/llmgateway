import { z } from "zod";

import {
	and,
	db,
	gte,
	inArray,
	projectHourlyModelStats,
	projectHourlySourceStats,
	projectHourlyStats,
	sql,
} from "@llmgateway/db";

export const profileSchema = z.object({
	username: z.string().nullable(),
	name: z.string().nullable(),
	image: z.string().nullable(),
	bio: z.string().nullable(),
	githubUsername: z.string().nullable(),
	xUsername: z.string().nullable(),
	createdAt: z.string(),
	isPublic: z.boolean(),
	stats: z.object({
		totalTokens: z.number(),
		totalRequests: z.number(),
		currentStreak: z.number(),
		longestStreak: z.number(),
		activeDays: z.number(),
	}),
	activity: z.array(
		z.object({
			date: z.string(),
			requestCount: z.number(),
			totalTokens: z.number(),
		}),
	),
	models: z.array(
		z.object({
			id: z.string(),
			provider: z.string(),
			requestCount: z.number(),
			totalTokens: z.number(),
		}),
	),
	providers: z.array(
		z.object({
			provider: z.string(),
			requestCount: z.number(),
			totalTokens: z.number(),
		}),
	),
	agents: z.array(
		z.object({
			source: z.string(),
			requestCount: z.number(),
			totalTokens: z.number(),
		}),
	),
});

// Coding-agent x-source values that count toward a profile's agent stats.
// Mirrors the AGENTS definitions used by the DevPass dashboard UI.
export const CODING_AGENT_SOURCES = [
	"claude.com/claude-code",
	"opencode",
	"open-code",
	"cursor",
	"autohand",
	"soulforge",
	"cline",
	"codex",
	"n8n",
	"openclaw",
];

export type ProfileData = z.infer<typeof profileSchema>;
type ProfileActivityDay = ProfileData["activity"][number];
type ProfileModelUsage = ProfileData["models"][number];
type ProfileProviderUsage = ProfileData["providers"][number];
type ProfileAgentUsage = ProfileData["agents"][number];

function dateKey(d: Date): string {
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function computeStreaks(activeDates: Set<string>): {
	currentStreak: number;
	longestStreak: number;
} {
	if (activeDates.size === 0) {
		return { currentStreak: 0, longestStreak: 0 };
	}

	// Longest streak across all active days.
	const sorted = Array.from(activeDates).sort();
	let longest = 0;
	let run = 0;
	let prev: Date | null = null;
	for (const key of sorted) {
		const current = new Date(key + "T00:00:00Z");
		if (prev) {
			const diffDays = Math.round(
				(current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24),
			);
			run = diffDays === 1 ? run + 1 : 1;
		} else {
			run = 1;
		}
		if (run > longest) {
			longest = run;
		}
		prev = current;
	}

	// Current streak counts back from today (allowing today to be inactive).
	const cursor = new Date();
	cursor.setUTCHours(0, 0, 0, 0);
	if (!activeDates.has(dateKey(cursor))) {
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}
	let current = 0;
	while (activeDates.has(dateKey(cursor))) {
		current += 1;
		cursor.setUTCDate(cursor.getUTCDate() - 1);
	}

	return { currentStreak: current, longestStreak: longest };
}

/**
 * Compute the public-facing DevPass profile payload for a user from their
 * personal organization's usage rollups. Returns null when the user does not
 * exist. Users without a personal org / usage get a zeroed profile.
 */
export async function computeProfileData(
	userId: string,
): Promise<ProfileData | null> {
	const userRecord = await db.query.user.findFirst({
		where: { id: userId },
	});

	if (!userRecord) {
		return null;
	}

	const base: ProfileData = {
		username: userRecord.username,
		name: userRecord.name,
		image: userRecord.image,
		bio: userRecord.bio,
		githubUsername: userRecord.githubUsername,
		xUsername: userRecord.xUsername,
		createdAt: userRecord.createdAt.toISOString(),
		isPublic: userRecord.profilePublic,
		stats: {
			totalTokens: 0,
			totalRequests: 0,
			currentStreak: 0,
			longestStreak: 0,
			activeDays: 0,
		},
		activity: [],
		models: [],
		providers: [],
		agents: [],
	};

	const userOrgs = await db.query.userOrganization.findMany({
		where: { userId },
		with: { organization: { with: { projects: true } } },
	});

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		return base;
	}

	const projectIds = personalOrg.projects
		.filter((p) => p.status !== "deleted")
		.map((p) => p.id);

	if (!projectIds.length) {
		return base;
	}

	const startDate = new Date();
	startDate.setUTCHours(0, 0, 0, 0);
	startDate.setUTCDate(startDate.getUTCDate() - 364);

	const [activityRows, modelRows, sourceRows] = await Promise.all([
		db
			.select({
				date: sql<string>`DATE(${projectHourlyStats.hourTimestamp})`.as("date"),
				requestCount:
					sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
						"requestCount",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
			})
			.from(projectHourlyStats)
			.where(
				and(
					inArray(projectHourlyStats.projectId, projectIds),
					gte(projectHourlyStats.hourTimestamp, startDate),
				),
			)
			.groupBy(sql`DATE(${projectHourlyStats.hourTimestamp})`)
			.orderBy(sql`DATE(${projectHourlyStats.hourTimestamp}) ASC`),
		db
			.select({
				usedModel: projectHourlyModelStats.usedModel,
				usedProvider: projectHourlyModelStats.usedProvider,
				requestCount:
					sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
						"requestCount",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
			})
			.from(projectHourlyModelStats)
			.where(inArray(projectHourlyModelStats.projectId, projectIds))
			.groupBy(
				projectHourlyModelStats.usedModel,
				projectHourlyModelStats.usedProvider,
			),
		db
			.select({
				source: projectHourlySourceStats.source,
				requestCount:
					sql<number>`COALESCE(SUM(${projectHourlySourceStats.requestCount}), 0)`.as(
						"requestCount",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlySourceStats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
			})
			.from(projectHourlySourceStats)
			.where(
				and(
					inArray(projectHourlySourceStats.projectId, projectIds),
					inArray(projectHourlySourceStats.source, CODING_AGENT_SOURCES),
				),
			)
			.groupBy(projectHourlySourceStats.source),
	]);

	const activity: ProfileActivityDay[] = activityRows.map((r) => ({
		date: String(r.date).slice(0, 10),
		requestCount: Number(r.requestCount),
		totalTokens: Number(r.totalTokens),
	}));

	const activeDates = new Set(
		activity.filter((d) => d.requestCount > 0).map((d) => d.date),
	);
	const { currentStreak, longestStreak } = computeStreaks(activeDates);

	const totalRequests = activity.reduce((sum, d) => sum + d.requestCount, 0);
	const totalTokens = activity.reduce((sum, d) => sum + d.totalTokens, 0);

	const models: ProfileModelUsage[] = modelRows
		.map((r) => ({
			id: r.usedModel,
			provider: r.usedProvider,
			requestCount: Number(r.requestCount),
			totalTokens: Number(r.totalTokens),
		}))
		.filter((m) => m.id && m.id !== "unknown" && m.requestCount > 0)
		.sort((a, b) => b.requestCount - a.requestCount);

	const providerMap = new Map<string, ProfileProviderUsage>();
	for (const m of models) {
		if (!m.provider || m.provider === "unknown") {
			continue;
		}
		const entry = providerMap.get(m.provider) ?? {
			provider: m.provider,
			requestCount: 0,
			totalTokens: 0,
		};
		entry.requestCount += m.requestCount;
		entry.totalTokens += m.totalTokens;
		providerMap.set(m.provider, entry);
	}
	const providers = Array.from(providerMap.values()).sort(
		(a, b) => b.requestCount - a.requestCount,
	);

	const agents: ProfileAgentUsage[] = sourceRows
		.map((r) => ({
			source: r.source,
			requestCount: Number(r.requestCount),
			totalTokens: Number(r.totalTokens),
		}))
		.filter((a) => a.requestCount > 0)
		.sort((a, b) => b.requestCount - a.requestCount);

	return {
		...base,
		stats: {
			totalTokens,
			totalRequests,
			currentStreak,
			longestStreak,
			activeDays: activeDates.size,
		},
		activity,
		models: models.slice(0, 6),
		providers,
		agents,
	};
}
