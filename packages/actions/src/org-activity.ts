import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

/**
 * Window in which an organization counts as actively serving requests. The
 * marker expires on its own, so its mere existence answers "any request in the
 * last 30 days?" without a Postgres read.
 */
export const ORG_REQUEST_ACTIVITY_TTL_SECONDS = 30 * 24 * 60 * 60;

export function orgRequestActivityKey(organizationId: string): string {
	return `org_activity:last_request:${organizationId}`;
}

/**
 * Stamp that an organization just served a request. Called from every billing
 * chokepoint (gateway `insertLog`, realtime billing, video submission) so the
 * signal is real-time rather than waiting on the hourly stats aggregator.
 * Fail-open: a Redis error must never break a request path.
 */
export async function markOrgRequestActivity(
	organizationId: string,
): Promise<void> {
	try {
		await redisClient.set(
			orgRequestActivityKey(organizationId),
			String(Date.now()),
			"EX",
			ORG_REQUEST_ACTIVITY_TTL_SECONDS,
		);
	} catch (error) {
		logger.error("Error recording org request activity:", error as Error);
	}
}

/** Whether the organization served a request within the activity window. */
export async function hasOrgRequestActivity(
	organizationId: string,
): Promise<boolean> {
	return (await redisClient.exists(orgRequestActivityKey(organizationId))) > 0;
}
