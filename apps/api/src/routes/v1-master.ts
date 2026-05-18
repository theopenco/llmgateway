import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { createApiKeyForProject } from "@/routes/keys-api.js";
import { createProjectForOrg } from "@/routes/projects.js";

import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";

export const v1Master = new OpenAPIHono<ServerTypes>();

interface AuthenticatedMasterKey {
	id: string;
	organizationId: string;
	createdBy: string;
}

declare module "hono" {
	interface ContextVariableMap {
		masterKey?: AuthenticatedMasterKey;
	}
}

v1Master.use("*", async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		throw new HTTPException(401, {
			message: "Missing or invalid Authorization header",
		});
	}

	const token = authHeader.slice("Bearer ".length).trim();
	if (!token) {
		throw new HTTPException(401, { message: "Missing bearer token" });
	}

	const tokenHash = getApiKeyFingerprint(token);

	const row = await db.query.masterKey.findFirst({
		where: { tokenHash: { eq: tokenHash }, status: { eq: "active" } },
		with: { organization: true },
	});

	if (!row) {
		throw new HTTPException(401, { message: "Invalid master key" });
	}

	if (row.organization?.status === "deleted") {
		throw new HTTPException(403, { message: "Organization is not active" });
	}

	if (row.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Master keys require an enterprise plan",
		});
	}

	c.set("masterKey", {
		id: row.id,
		organizationId: row.organizationId,
		createdBy: row.createdBy,
	});

	void db
		.update(tables.masterKey)
		.set({ lastUsedAt: new Date() })
		.where(eq(tables.masterKey.id, row.id))
		.catch(() => {
			// best-effort; don't fail the request if the touch fails
		});

	await next();
});

const projectModeEnum = z.enum(["api-keys", "credits", "hybrid"]);

const projectSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	organizationId: z.string(),
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z.number(),
	mode: projectModeEnum,
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
});

const createProjectBody = z.object({
	name: z.string().min(1).max(255),
	cachingEnabled: z.boolean().optional(),
	cacheDurationSeconds: z.number().min(10).max(31536000).optional(),
	mode: projectModeEnum.optional(),
});

const createProject = createRoute({
	method: "post",
	path: "/projects",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createProjectBody,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ project: projectSchema.openapi({}) }),
				},
			},
			description: "Project created successfully via master key.",
		},
	},
});

const listProjects = createRoute({
	method: "get",
	path: "/projects",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						projects: z.array(projectSchema).openapi({}),
					}),
				},
			},
			description:
				"List all non-deleted projects in the master key's organization.",
		},
	},
});

v1Master.openapi(listProjects, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const projects = await db.query.project.findMany({
		where: {
			organizationId: { eq: masterKey.organizationId },
			status: { ne: "deleted" },
		},
	});

	return c.json({ projects });
});

v1Master.openapi(createProject, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const input = c.req.valid("json");

	const project = await createProjectForOrg(
		masterKey.organizationId,
		masterKey.createdBy,
		input,
		{ skipAccessCheck: true },
	);

	return c.json({ project }, 201);
});

const apiKeyPeriodUnit = z.enum(["hour", "day", "week", "month"]);

const nonNegativeDecimal = z
	.string()
	.regex(/^\d+(?:\.\d+)?$/, "must be a non-negative number");

const createApiKeyBody = z.object({
	projectId: z.string().min(1),
	description: z.string().min(1).max(255),
	usageLimit: nonNegativeDecimal.nullable().optional(),
	periodUsageLimit: nonNegativeDecimal.nullable().optional(),
	periodUsageDurationValue: z.number().int().positive().nullable().optional(),
	periodUsageDurationUnit: apiKeyPeriodUnit.nullable().optional(),
});

const apiKeyResponseSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	token: z.string(),
	description: z.string(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	projectId: z.string(),
	createdBy: z.string(),
});

const createApiKey = createRoute({
	method: "post",
	path: "/keys",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createApiKeyBody,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						apiKey: apiKeyResponseSchema.openapi({}),
					}),
				},
			},
			description:
				"Gateway API key created successfully via master key. The plain token is returned only once.",
		},
	},
});

v1Master.openapi(createApiKey, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId, ...rest } = c.req.valid("json");

	const project = await db.query.project.findFirst({
		where: { id: { eq: projectId } },
	});

	if (
		!project ||
		project.status === "deleted" ||
		project.organizationId !== masterKey.organizationId
	) {
		throw new HTTPException(404, {
			message: "Project not found in this organization",
		});
	}

	const { apiKey, token } = await createApiKeyForProject(
		projectId,
		masterKey.createdBy,
		rest,
		{ skipAccessCheck: true },
	);

	return c.json(
		{
			apiKey: {
				id: apiKey.id,
				createdAt: apiKey.createdAt,
				updatedAt: apiKey.updatedAt,
				token,
				description: apiKey.description,
				status: apiKey.status,
				projectId: apiKey.projectId,
				createdBy: apiKey.createdBy,
			},
		},
		201,
	);
});

export default v1Master;
