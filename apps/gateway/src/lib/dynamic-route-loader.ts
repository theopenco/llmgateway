import { swrWrap } from "@llmgateway/cache";
import {
	and,
	cdb,
	dynamicRoute,
	dynamicRouteVersion,
	eq,
	getTableName,
} from "@llmgateway/db";

import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

const dynamicRouteTableName = getTableName(dynamicRoute);
const dynamicRouteVersionTableName = getTableName(dynamicRouteVersion);

export interface PublishedDynamicRoute {
	id: string;
	name: string;
	version: number;
	graph: DynamicRouteGraph;
}

/**
 * Loads the published version of an enabled dynamic route for a project.
 * Returns null when the route doesn't exist, is disabled, or has no published
 * version. Cached via SWR and invalidated by API mutations on the route
 * tables.
 */
export async function getPublishedDynamicRoute(
	projectId: string,
	name: string,
): Promise<PublishedDynamicRoute | null> {
	return await swrWrap(
		`dynamicRoute:${projectId}:${name}`,
		[dynamicRouteTableName, dynamicRouteVersionTableName],
		async (): Promise<PublishedDynamicRoute | null> => {
			const rows = await cdb
				.select({
					id: dynamicRoute.id,
					name: dynamicRoute.name,
					version: dynamicRouteVersion.version,
					graph: dynamicRouteVersion.graph,
				})
				.from(dynamicRoute)
				.innerJoin(
					dynamicRouteVersion,
					eq(dynamicRoute.publishedVersionId, dynamicRouteVersion.id),
				)
				.where(
					and(
						eq(dynamicRoute.projectId, projectId),
						eq(dynamicRoute.name, name),
						eq(dynamicRoute.enabled, true),
					),
				)
				.limit(1);

			return rows[0] ?? null;
		},
	);
}
