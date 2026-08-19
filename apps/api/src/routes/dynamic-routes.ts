import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, cdb, db, eq, sql, tables } from "@llmgateway/db";
import {
	DYNAMIC_ROUTE_NAME_MESSAGE,
	DYNAMIC_ROUTE_NAME_REGEX,
	dynamicRouteGraphSchema,
	parseCustomDynamicRouteModelRef,
} from "@llmgateway/shared/dynamic-route";

import { checkProjectEnterpriseAccess } from "./routing-config.js";

import type { ServerTypes } from "@/vars.js";
import type { DynamicRouteGraph } from "@llmgateway/shared/dynamic-route";

export const dynamicRoutes = new OpenAPIHono<ServerTypes>();

const routeNameSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(DYNAMIC_ROUTE_NAME_REGEX, DYNAMIC_ROUTE_NAME_MESSAGE);

const versionSummarySchema = z.object({
	id: z.string(),
	version: z.number(),
	createdAt: z.date(),
});

const routeSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
	publishedVersion: versionSummarySchema.nullable(),
	hasDraft: z.boolean(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const routeDetailSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string().nullable(),
	enabled: z.boolean(),
	draftGraph: dynamicRouteGraphSchema.nullable(),
	publishedVersion: versionSummarySchema
		.extend({ graph: dynamicRouteGraphSchema })
		.nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

async function findRouteOrThrow(projectId: string, name: string) {
	const route = await db.query.dynamicRoute.findFirst({
		where: { projectId: { eq: projectId }, name: { eq: name } },
	});
	if (!route) {
		throw new HTTPException(404, {
			message: `Dynamic route "${name}" not found`,
		});
	}
	return route;
}

async function routeDetail(routeId: string) {
	const route = await db.query.dynamicRoute.findFirst({
		where: { id: { eq: routeId } },
		with: { publishedVersion: true },
	});
	if (!route) {
		throw new HTTPException(404, { message: "Dynamic route not found" });
	}
	return {
		id: route.id,
		name: route.name,
		description: route.description,
		enabled: route.enabled,
		draftGraph: route.draftGraph,
		publishedVersion: route.publishedVersion
			? {
					id: route.publishedVersion.id,
					version: route.publishedVersion.version,
					createdAt: route.publishedVersion.createdAt,
					graph: route.publishedVersion.graph,
				}
			: null,
		createdAt: route.createdAt,
		updatedAt: route.updatedAt,
	};
}

async function assertCustomModelsAvailable(
	organizationId: string,
	graph: DynamicRouteGraph,
) {
	const references = graph.nodes.flatMap((node) => {
		if (node.type !== "model") {
			return [];
		}
		const reference = parseCustomDynamicRouteModelRef(node.model);
		return reference ? [reference] : [];
	});
	if (references.length === 0) {
		return;
	}

	const customProviders = await db.query.providerKey.findMany({
		where: {
			organizationId: { eq: organizationId },
			provider: { eq: "custom" },
			status: { eq: "active" },
		},
		with: {
			customModels: { where: { status: { eq: "active" } } },
		},
	});
	const available = new Set(
		customProviders.flatMap((provider) =>
			provider.name
				? provider.customModels.map(
						(model) => `${provider.name}/${model.modelName}`,
					)
				: [],
		),
	);
	const missing = references.find(
		(reference) =>
			!available.has(`${reference.providerName}/${reference.modelName}`),
	);
	if (missing) {
		throw new HTTPException(400, {
			message: `Custom model "${missing.providerName}/${missing.modelName}" is not available in this organization`,
		});
	}
}

const listRoutes = createRoute({
	method: "get",
	path: "/{projectId}",
	request: { params: z.object({ projectId: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ routes: z.array(routeSummarySchema) }),
				},
			},
			description: "Dynamic routes for the project",
		},
	},
});

dynamicRoutes.openapi(listRoutes, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);

	const routes = await db.query.dynamicRoute.findMany({
		where: { projectId: { eq: projectId } },
		with: { publishedVersion: true },
		orderBy: { name: "asc" },
	});

	return c.json({
		routes: routes.map((route) => ({
			id: route.id,
			name: route.name,
			description: route.description,
			enabled: route.enabled,
			publishedVersion: route.publishedVersion
				? {
						id: route.publishedVersion.id,
						version: route.publishedVersion.version,
						createdAt: route.publishedVersion.createdAt,
					}
				: null,
			hasDraft: route.draftGraph !== null,
			createdAt: route.createdAt,
			updatedAt: route.updatedAt,
		})),
	});
});

const createRouteEndpoint = createRoute({
	method: "post",
	path: "/{projectId}",
	request: {
		params: z.object({ projectId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: routeNameSchema,
						description: z.string().max(500).optional(),
						graph: dynamicRouteGraphSchema.optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: { "application/json": { schema: routeDetailSchema } },
			description: "Created dynamic route",
		},
	},
});

dynamicRoutes.openapi(createRouteEndpoint, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.param();
	const { project } = await checkProjectEnterpriseAccess(user.id, projectId);
	const body = c.req.valid("json");
	if (body.graph) {
		await assertCustomModelsAvailable(project.organizationId, body.graph);
	}

	// The insert itself is the authoritative duplicate check: concurrent
	// creates race past any pre-read, so let the unique (projectId, name)
	// constraint decide and map the conflict to a 409.
	const [row] = await cdb
		.insert(tables.dynamicRoute)
		.values({
			projectId,
			name: body.name,
			description: body.description ?? null,
			draftGraph: (body.graph ?? null) as DynamicRouteGraph | null,
		})
		.onConflictDoNothing({
			target: [tables.dynamicRoute.projectId, tables.dynamicRoute.name],
		})
		.returning();

	if (!row) {
		throw new HTTPException(409, {
			message: `A dynamic route named "${body.name}" already exists in this project`,
		});
	}

	return c.json(await routeDetail(row.id), 201);
});

const getRoute = createRoute({
	method: "get",
	path: "/{projectId}/{name}",
	request: {
		params: z.object({ projectId: z.string(), name: z.string() }),
	},
	responses: {
		200: {
			content: { "application/json": { schema: routeDetailSchema } },
			description: "Dynamic route with draft and published graphs",
		},
	},
});

dynamicRoutes.openapi(getRoute, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId, name } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);
	const route = await findRouteOrThrow(projectId, name);

	return c.json(await routeDetail(route.id));
});

const updateRoute = createRoute({
	method: "patch",
	path: "/{projectId}/{name}",
	request: {
		params: z.object({ projectId: z.string(), name: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						enabled: z.boolean().optional(),
						description: z.string().max(500).nullable().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: routeDetailSchema } },
			description: "Updated dynamic route",
		},
	},
});

dynamicRoutes.openapi(updateRoute, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId, name } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);
	const route = await findRouteOrThrow(projectId, name);
	const body = c.req.valid("json");

	const set: Record<string, unknown> = {};
	if (body.enabled !== undefined) {
		set.enabled = body.enabled;
	}
	if (body.description !== undefined) {
		set.description = body.description;
	}
	if (Object.keys(set).length > 0) {
		await cdb
			.update(tables.dynamicRoute)
			.set(set)
			.where(eq(tables.dynamicRoute.id, route.id));
	}

	return c.json(await routeDetail(route.id));
});

const deleteRoute = createRoute({
	method: "delete",
	path: "/{projectId}/{name}",
	request: {
		params: z.object({ projectId: z.string(), name: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ ok: z.boolean() }) },
			},
			description: "Deleted dynamic route",
		},
	},
});

dynamicRoutes.openapi(deleteRoute, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId, name } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);
	const route = await findRouteOrThrow(projectId, name);

	await cdb
		.delete(tables.dynamicRoute)
		.where(eq(tables.dynamicRoute.id, route.id));

	return c.json({ ok: true });
});

const updateDraft = createRoute({
	method: "put",
	path: "/{projectId}/{name}/draft",
	request: {
		params: z.object({ projectId: z.string(), name: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ graph: dynamicRouteGraphSchema }),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: routeDetailSchema } },
			description: "Updated draft graph",
		},
	},
});

dynamicRoutes.openapi(updateDraft, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId, name } = c.req.param();
	const { project } = await checkProjectEnterpriseAccess(user.id, projectId);
	const route = await findRouteOrThrow(projectId, name);
	const body = c.req.valid("json");
	await assertCustomModelsAvailable(project.organizationId, body.graph);

	await cdb
		.update(tables.dynamicRoute)
		.set({ draftGraph: body.graph as DynamicRouteGraph })
		.where(eq(tables.dynamicRoute.id, route.id));

	return c.json(await routeDetail(route.id));
});

const publishRoute = createRoute({
	method: "post",
	path: "/{projectId}/{name}/publish",
	request: {
		params: z.object({ projectId: z.string(), name: z.string() }),
	},
	responses: {
		200: {
			content: { "application/json": { schema: routeDetailSchema } },
			description: "Published the draft graph as a new version",
		},
	},
});

dynamicRoutes.openapi(publishRoute, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId, name } = c.req.param();
	const { project } = await checkProjectEnterpriseAccess(user.id, projectId);
	const route = await findRouteOrThrow(projectId, name);

	if (!route.draftGraph) {
		throw new HTTPException(400, {
			message: "This route has no draft graph to publish",
		});
	}
	// Re-validate the draft at publish time so a graph saved before a catalog
	// change (e.g. a removed model) can never become the published version.
	const parsed = dynamicRouteGraphSchema.safeParse(route.draftGraph);
	if (!parsed.success) {
		throw new HTTPException(400, {
			message: `Draft graph is no longer valid: ${parsed.error.issues[0]?.message}`,
		});
	}
	await assertCustomModelsAvailable(project.organizationId, parsed.data);

	// Version insert and pointer re-point must land together (no orphan
	// version rows), and the next version number is derived inside the
	// database so concurrent publishes can't both read the same stale max.
	await cdb.transaction(async (tx) => {
		// Lock the route row so concurrent publishes serialize: without it two
		// transactions can derive the same max(version)+1 and one dies on the
		// unique (routeId, version) constraint.
		await tx
			.select({ id: tables.dynamicRoute.id })
			.from(tables.dynamicRoute)
			.where(eq(tables.dynamicRoute.id, route.id))
			.for("update");
		const [versionRow] = await tx
			.insert(tables.dynamicRouteVersion)
			.values({
				routeId: route.id,
				version: sql<number>`coalesce((select max(${tables.dynamicRouteVersion.version}) from ${tables.dynamicRouteVersion} where ${tables.dynamicRouteVersion.routeId} = ${route.id}), 0) + 1`,
				graph: parsed.data as DynamicRouteGraph,
				createdBy: user.id,
			})
			.returning();

		await tx
			.update(tables.dynamicRoute)
			.set({ publishedVersionId: versionRow.id })
			.where(eq(tables.dynamicRoute.id, route.id));
	});

	return c.json(await routeDetail(route.id));
});

const rollbackRoute = createRoute({
	method: "post",
	path: "/{projectId}/{name}/rollback",
	request: {
		params: z.object({ projectId: z.string(), name: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ versionId: z.string() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: routeDetailSchema } },
			description: "Re-pointed the published version",
		},
	},
});

dynamicRoutes.openapi(rollbackRoute, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId, name } = c.req.param();
	const { project } = await checkProjectEnterpriseAccess(user.id, projectId);
	const route = await findRouteOrThrow(projectId, name);
	const body = c.req.valid("json");

	const version = await db.query.dynamicRouteVersion.findFirst({
		where: { id: { eq: body.versionId }, routeId: { eq: route.id } },
	});
	if (!version) {
		throw new HTTPException(404, {
			message: "Version not found for this route",
		});
	}

	// Old versions can reference models/providers that have since left the
	// catalog; re-validate like publish does so rollback can't re-enable a
	// graph that would fail at request time.
	const parsed = dynamicRouteGraphSchema.safeParse(version.graph);
	if (!parsed.success) {
		throw new HTTPException(400, {
			message: `Version ${version.version} is no longer valid: ${parsed.error.issues[0]?.message}`,
		});
	}
	await assertCustomModelsAvailable(project.organizationId, parsed.data);

	await cdb
		.update(tables.dynamicRoute)
		.set({ publishedVersionId: version.id })
		.where(
			and(
				eq(tables.dynamicRoute.id, route.id),
				eq(tables.dynamicRoute.projectId, projectId),
			),
		);

	return c.json(await routeDetail(route.id));
});

const listVersions = createRoute({
	method: "get",
	path: "/{projectId}/{name}/versions",
	request: {
		params: z.object({ projectId: z.string(), name: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						versions: z.array(
							versionSummarySchema.extend({
								graph: dynamicRouteGraphSchema,
								published: z.boolean(),
								createdBy: z.string().nullable(),
							}),
						),
					}),
				},
			},
			description: "Version history for the route",
		},
	},
});

dynamicRoutes.openapi(listVersions, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId, name } = c.req.param();
	await checkProjectEnterpriseAccess(user.id, projectId);
	const route = await findRouteOrThrow(projectId, name);

	const versions = await db.query.dynamicRouteVersion.findMany({
		where: { routeId: { eq: route.id } },
		orderBy: { version: "desc" },
	});

	return c.json({
		versions: versions.map((version) => ({
			id: version.id,
			version: version.version,
			createdAt: version.createdAt,
			graph: version.graph,
			published: version.id === route.publishedVersionId,
			createdBy: version.createdBy,
		})),
	});
});
