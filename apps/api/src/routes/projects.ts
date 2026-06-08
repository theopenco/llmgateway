import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getUserOrganizationIds } from "@/utils/authorization.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const projects = new OpenAPIHono<ServerTypes>();

// Define schema directly with Zod instead of using createSelectSchema
const projectSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	organizationId: z.string(),
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z.number(),
	providerCacheControlEnabled: z.boolean(),
	mode: z.enum(["api-keys", "credits", "hybrid"]),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	endUserEnabled: z.boolean(),
	endUserMarkupPercent: z.string(),
	allowedOrigins: z.array(z.string()).nullable(),
});

const createProjectSchema = z.object({
	name: z.string().min(1).max(255),
	organizationId: z.string().min(1),
	cachingEnabled: z.boolean().optional(),
	cacheDurationSeconds: z.number().min(10).max(31536000).optional(),
	providerCacheControlEnabled: z.boolean().optional(),
	mode: z.enum(["api-keys", "credits", "hybrid"]).optional(),
});

const updateProjectSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	cachingEnabled: z.boolean().optional(),
	cacheDurationSeconds: z.number().min(10).max(31536000).optional(), // Min 10 seconds, max 1 year
	providerCacheControlEnabled: z.boolean().optional(),
	mode: z.enum(["api-keys", "credits", "hybrid"]).optional(),
	endUserEnabled: z.boolean().optional(),
	endUserMarkupPercent: z.number().min(0).max(100).optional(),
	allowedOrigins: z.array(z.string().trim().min(1)).max(20).optional(),
});

function normalizeAllowedOrigins(origins: string[]) {
	const normalizedOrigins = new Set<string>();

	for (const origin of origins) {
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new HTTPException(400, {
				message: `Invalid allowed origin: ${origin}`,
			});
		}

		if (url.protocol !== "https:" && url.protocol !== "http:") {
			throw new HTTPException(400, {
				message: "Allowed origins must use http or https.",
			});
		}

		normalizedOrigins.add(url.origin);
	}

	return Array.from(normalizedOrigins);
}

const getProject = createRoute({
	method: "get",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						project: projectSchema.openapi({}),
					}),
				},
			},
			description: "Project retrieved successfully.",
		},
	},
});

const updateProject = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateProjectSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						project: projectSchema.openapi({}),
					}),
				},
			},
			description: "Project settings updated successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Project not found.",
		},
	},
});

projects.openapi(getProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const orgIds = await getUserOrganizationIds(user.id);

	const project = await db.query.project.findFirst({
		where: {
			id: {
				eq: id,
			},
			organizationId: {
				in: orgIds,
			},
		},
	});

	if (!project || project.status === "deleted") {
		throw new HTTPException(404, {
			message: "Project not found",
		});
	}

	return c.json({
		project,
	});
});

projects.openapi(updateProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const {
		name,
		cachingEnabled,
		cacheDurationSeconds,
		providerCacheControlEnabled,
		mode,
		endUserEnabled,
		endUserMarkupPercent,
		allowedOrigins,
	} = c.req.valid("json");

	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
		},
		with: {
			organization: true,
		},
	});

	const orgIds = userOrgs.map((uo) => uo.organization!.id);

	const project = await db.query.project.findFirst({
		where: {
			id: {
				eq: id,
			},
			organizationId: {
				in: orgIds,
			},
		},
	});

	if (!project || project.status === "deleted") {
		throw new HTTPException(404, {
			message: "Project not found",
		});
	}

	const isUpdatingEndUserSettings =
		endUserEnabled !== undefined ||
		endUserMarkupPercent !== undefined ||
		allowedOrigins !== undefined;
	const projectUserOrg = userOrgs.find(
		(userOrg) => userOrg.organizationId === project.organizationId,
	);
	if (
		isUpdatingEndUserSettings &&
		projectUserOrg?.role !== "owner" &&
		projectUserOrg?.role !== "admin"
	) {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can update SDK settings",
		});
	}

	const updateData: Partial<typeof tables.project.$inferInsert> = {};
	let normalizedAllowedOrigins: string[] | undefined;

	if (name !== undefined) {
		updateData.name = name;
	}

	if (cachingEnabled !== undefined) {
		updateData.cachingEnabled = cachingEnabled;
	}

	if (cacheDurationSeconds !== undefined) {
		updateData.cacheDurationSeconds = cacheDurationSeconds;
	}

	if (providerCacheControlEnabled !== undefined) {
		updateData.providerCacheControlEnabled = providerCacheControlEnabled;
	}

	if (mode !== undefined) {
		updateData.mode = mode;
	}

	if (endUserEnabled !== undefined) {
		updateData.endUserEnabled = endUserEnabled;
	}

	if (endUserMarkupPercent !== undefined) {
		updateData.endUserMarkupPercent = String(endUserMarkupPercent);
	}

	if (allowedOrigins !== undefined) {
		normalizedAllowedOrigins = normalizeAllowedOrigins(allowedOrigins);
		updateData.allowedOrigins = normalizedAllowedOrigins;
	}

	const [updatedProject] = await db
		.update(tables.project)
		.set(updateData)
		.where(eq(tables.project.id, id))
		.returning();

	// Build changes metadata for audit log
	const changes: Record<string, { old: unknown; new: unknown }> = {};
	if (name !== undefined && name !== project.name) {
		changes.name = { old: project.name, new: name };
	}
	if (
		cachingEnabled !== undefined &&
		cachingEnabled !== project.cachingEnabled
	) {
		changes.cachingEnabled = {
			old: project.cachingEnabled,
			new: cachingEnabled,
		};
	}
	if (
		cacheDurationSeconds !== undefined &&
		cacheDurationSeconds !== project.cacheDurationSeconds
	) {
		changes.cacheDurationSeconds = {
			old: project.cacheDurationSeconds,
			new: cacheDurationSeconds,
		};
	}
	if (
		providerCacheControlEnabled !== undefined &&
		providerCacheControlEnabled !== project.providerCacheControlEnabled
	) {
		changes.providerCacheControlEnabled = {
			old: project.providerCacheControlEnabled,
			new: providerCacheControlEnabled,
		};
	}
	if (mode !== undefined && mode !== project.mode) {
		changes.mode = { old: project.mode, new: mode };
	}
	if (
		endUserEnabled !== undefined &&
		endUserEnabled !== project.endUserEnabled
	) {
		changes.endUserEnabled = {
			old: project.endUserEnabled,
			new: endUserEnabled,
		};
	}
	if (
		endUserMarkupPercent !== undefined &&
		String(endUserMarkupPercent) !== project.endUserMarkupPercent
	) {
		changes.endUserMarkupPercent = {
			old: project.endUserMarkupPercent,
			new: String(endUserMarkupPercent),
		};
	}
	if (normalizedAllowedOrigins !== undefined) {
		const previousAllowedOrigins = project.allowedOrigins ?? [];
		if (
			JSON.stringify(normalizedAllowedOrigins) !==
			JSON.stringify(previousAllowedOrigins)
		) {
			changes.allowedOrigins = {
				old: previousAllowedOrigins,
				new: normalizedAllowedOrigins,
			};
		}
	}

	if (Object.keys(changes).length > 0) {
		await logAuditEvent({
			organizationId: project.organizationId,
			userId: user.id,
			action: "project.update",
			resourceType: "project",
			resourceId: id,
			metadata: { changes, resourceName: project.name },
		});
	}

	return c.json({
		message: "Project settings updated successfully",
		project: updatedProject,
	});
});

const createProject = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createProjectSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						project: projectSchema.openapi({}),
					}),
				},
			},
			description: "Project created successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		403: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "You do not have access to this organization.",
		},
	},
});

export interface CreateProjectInput {
	name: string;
	cachingEnabled?: boolean;
	cacheDurationSeconds?: number;
	providerCacheControlEnabled?: boolean;
	mode?: "api-keys" | "credits" | "hybrid";
}

export async function createProjectForOrg(
	organizationId: string,
	userId: string,
	input: CreateProjectInput,
	options: { skipAccessCheck?: boolean } = {},
) {
	const {
		name,
		cachingEnabled = false,
		cacheDurationSeconds = 60,
		providerCacheControlEnabled = true,
		mode = "hybrid",
	} = input;

	if (!options.skipAccessCheck) {
		const userOrganization = await db.query.userOrganization.findFirst({
			where: {
				userId: { eq: userId },
				organizationId: { eq: organizationId },
			},
			with: { organization: true },
		});

		if (
			!userOrganization ||
			userOrganization.organization?.status === "deleted"
		) {
			throw new HTTPException(403, {
				message: "You do not have access to this organization",
			});
		}
	}

	const organizationRow = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});

	if (!organizationRow || organizationRow.status === "deleted") {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const existingProjects = await db.query.project.findMany({
		where: {
			organizationId: { eq: organizationId },
			status: { ne: "deleted" },
		},
	});

	const projectLimit = organizationRow.plan === "enterprise" ? 250 : 10;

	if (existingProjects.length >= projectLimit) {
		throw new HTTPException(403, {
			message: `You have reached the limit of ${projectLimit} projects. Contact us at contact@llmgateway.io to unlock more.`,
		});
	}

	const [newProject] = await db
		.insert(tables.project)
		.values({
			name,
			organizationId,
			cachingEnabled,
			cacheDurationSeconds,
			providerCacheControlEnabled,
			mode,
		})
		.returning();

	await logAuditEvent({
		organizationId,
		userId,
		action: "project.create",
		resourceType: "project",
		resourceId: newProject.id,
		metadata: { resourceName: name, mode, cachingEnabled },
	});

	return newProject;
}

projects.openapi(createProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const body = c.req.valid("json");
	const { organizationId, ...rest } = body;

	const newProject = await createProjectForOrg(organizationId, user.id, rest);

	return c.json(
		{
			project: newProject,
		},
		201,
	);
});

const deleteProject = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Project deleted successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Project not found.",
		},
	},
});

projects.openapi(deleteProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
		},
		with: {
			organization: true,
		},
	});

	const orgIds = userOrgs.map((uo) => uo.organization!.id);

	const project = await db.query.project.findFirst({
		where: {
			id: {
				eq: id,
			},
			organizationId: {
				in: orgIds,
			},
		},
	});

	if (!project || project.status === "deleted") {
		throw new HTTPException(404, {
			message: "Project not found",
		});
	}

	// Only owners can delete projects
	const userOrg = userOrgs.find(
		(uo) => uo.organizationId === project.organizationId,
	);
	if (!userOrg || userOrg.role !== "owner") {
		throw new HTTPException(403, {
			message: "Only owners can delete projects",
		});
	}

	await db
		.update(tables.project)
		.set({
			status: "deleted",
		})
		.where(eq(tables.project.id, id));

	await logAuditEvent({
		organizationId: project.organizationId,
		userId: user.id,
		action: "project.delete",
		resourceType: "project",
		resourceId: id,
		metadata: { resourceName: project.name },
	});

	return c.json({
		message: "Project deleted successfully",
	});
});

export default projects;
