import {
	and,
	db,
	eq,
	gte,
	projectHourlyStats,
	sql,
	tables,
} from "@llmgateway/db";

/**
 * How long an organization has to be idle before its owner may delete it. An
 * org that served requests this recently is probably still wired into a
 * production app.
 */
export const ORGANIZATION_DELETE_IDLE_HOURS = 72;

export interface OrganizationDeletionBlockers {
	/** Balance is above zero (or unreadable), so deleting would forfeit money. */
	positiveCredits: boolean;
	/** The org served inference requests within the idle window. */
	recentRequests: boolean;
}

export function hasPositiveCredits(credits: string | null): boolean {
	// `!(credits <= 0)` so an unparseable balance (NaN) also counts as positive:
	// refusing the delete is the safe direction.
	return !(Number(credits ?? "0") <= 0);
}

/**
 * Start of the hour bucket that contains `now - idle window`, so a bucket
 * straddling the cutoff still counts.
 */
export function getRecentRequestsCutoff(now = new Date()): Date {
	const cutoff = new Date(
		now.getTime() - ORGANIZATION_DELETE_IDLE_HOURS * 60 * 60 * 1000,
	);
	cutoff.setUTCMinutes(0, 0, 0);
	return cutoff;
}

export async function hasRecentRequests(
	organizationId: string,
	now = new Date(),
): Promise<boolean> {
	const [row] = await db
		.select({
			requestCount: sql<string>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`,
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.where(
			and(
				eq(tables.project.organizationId, organizationId),
				gte(projectHourlyStats.hourTimestamp, getRecentRequestsCutoff(now)),
			),
		);

	return Number(row?.requestCount ?? 0) > 0;
}

export async function getOrganizationDeletionBlockers(org: {
	id: string;
	credits: string | null;
}): Promise<OrganizationDeletionBlockers> {
	return {
		positiveCredits: hasPositiveCredits(org.credits),
		recentRequests: await hasRecentRequests(org.id),
	};
}
