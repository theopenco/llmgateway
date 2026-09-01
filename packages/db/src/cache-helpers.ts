import { and, eq, getTableName } from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { cdb, drizzleCache } from "./cdb.js";
import {
	project as projectTable,
	providerKey as providerKeyTable,
} from "./schema.js";

import type { ProviderCacheControlMode } from "@llmgateway/models";
import type { InferSelectModel } from "drizzle-orm";

const projectTableName = getTableName(projectTable);
const providerKeyTableName = getTableName(providerKeyTable);

/**
 * Cache tag under which the gateway caches an organization's row (see
 * `findOrganizationCachedById`). Shared with the worker, which evicts these
 * tags right after debiting credits so the gateway's credit gates see the new
 * balance immediately instead of after the cache TTL.
 */
export function organizationCacheTag(organizationId: string): string {
	return `org:${organizationId}`;
}

export function organizationFreshCacheTag(organizationId: string): string {
	return `org-fresh:${organizationId}`;
}

/**
 * Evict the tagged org-row cache entries for the given organizations.
 * Best-effort: a failure only delays freshness until the TTL, so it must
 * never break the caller (the worker's billing loop).
 */
export async function invalidateOrganizationsCache(
	organizationIds: string[],
): Promise<void> {
	if (organizationIds.length === 0) {
		return;
	}
	try {
		await drizzleCache.onMutate({
			tags: organizationIds.flatMap((organizationId) => [
				organizationCacheTag(organizationId),
				organizationFreshCacheTag(organizationId),
			]),
		});
	} catch (error) {
		logger.error(
			"Error invalidating organization cache tags",
			error instanceof Error ? error : new Error(String(error)),
			{ organizationIds },
		);
	}
}

/**
 * Look up project caching settings.
 *
 * Returns both gateway-side caching settings (`enabled`, `duration`) and the
 * provider-side cache control mode (`providerCacheControlMode`) that decides
 * whether caller-supplied cache_control / cachePoint markers are forwarded and
 * whether the gateway injects its own into upstream requests.
 *
 * Uses the cached database client (cdb) plus swrWrap so the answer survives a
 * Postgres outage (falls back to the last-known value for up to SWR TTL).
 */
export async function isCachingEnabled(projectId: string): Promise<{
	enabled: boolean;
	duration: number;
	providerCacheControlMode: ProviderCacheControlMode;
}> {
	try {
		return await swrWrap(
			`project:cachingEnabled:${projectId}`,
			[projectTableName],
			async () => {
				const results = await cdb
					.select({
						cachingEnabled: projectTable.cachingEnabled,
						cacheDurationSeconds: projectTable.cacheDurationSeconds,
						providerCacheControlMode: projectTable.providerCacheControlMode,
					})
					.from(projectTable)
					.where(eq(projectTable.id, projectId))
					.limit(1);

				const project = results[0];

				if (!project) {
					return {
						enabled: false,
						duration: 0,
						providerCacheControlMode: "auto" as ProviderCacheControlMode,
					};
				}

				return {
					enabled: project.cachingEnabled || false,
					duration: project.cacheDurationSeconds || 60,
					providerCacheControlMode: project.providerCacheControlMode ?? "auto",
				};
			},
		);
	} catch (error) {
		logger.error("Error checking if caching is enabled:", error as Error);
		throw error;
	}
}

/**
 * Find a specific managed credential by id (cacheable).
 *
 * Used by long-running work that pinned a credential at creation time — video
 * jobs poll for their result minutes to hours later and some providers scope
 * job visibility to the creating credential, so the exact row must come back
 * rather than a freshly selected one.
 *
 * Lives here rather than in the gateway so the worker, which polls those same
 * jobs, resolves the credential through the same cached path instead of its
 * own uncached read.
 *
 * Deliberately does not filter on status: a credential deactivated after a job
 * started must still be able to finish that job.
 */
export async function findManagedProviderKeyById(
	id: string,
): Promise<InferSelectModel<typeof providerKeyTable> | undefined> {
	const results = await swrWrap(
		`providerKey:managedById:${id}`,
		[providerKeyTableName],
		async () =>
			await cdb
				.select()
				.from(providerKeyTable)
				.where(
					and(eq(providerKeyTable.id, id), eq(providerKeyTable.managed, true)),
				)
				.limit(1),
	);
	return results[0];
}

// Re-export cache functions for convenience
export {
	generateCacheKey,
	generateStreamingCacheKey,
	getCache,
	getStreamingCache,
	setCache,
	setStreamingCache,
} from "@llmgateway/cache";
