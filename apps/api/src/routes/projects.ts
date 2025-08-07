import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { db, eq, tables } from "@llmgateway/db";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ServerTypes } from "../vars";

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
	mode: z.enum(["api-keys", "credits", "hybrid"]),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
});

const createProjectSchema = z.object({
	name: z.string().min(1).max(255),
	organizationId: z.string().min(1),
	cachingEnabled: z.boolean().optional(),
	cacheDurationSeconds: z.number().min(10).max(31536000).optional(),
	mode: z.enum(["api-keys", "credits", "hybrid"]).optional(),
});

const updateProjectCachingSchema = z.object({
	cachingEnabled: z.boolean().optional(),
	cacheDurationSeconds: z.number().min(10).max(31536000).optional(), // Min 10 seconds, max 1 year
	mode: z.enum(["api-keys", "credits", "hybrid"]).optional(),
});

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
					schema: updateProjectCachingSchema,
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
	const { cachingEnabled, cacheDurationSeconds, mode } = c.req.valid("json");

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

	const updateData: any = {};

	if (cachingEnabled !== undefined) {
		updateData.cachingEnabled = cachingEnabled;
	}

	if (cacheDurationSeconds !== undefined) {
		updateData.cacheDurationSeconds = cacheDurationSeconds;
	}

	if (mode !== undefined) {
		// Check if pro plan is required for API keys or hybrid mode in hosted environment
		const isHosted = process.env.HOSTED === "true";
		const isPaidMode = process.env.PAID_MODE === "true";

		if ((mode === "api-keys" || mode === "hybrid") && isHosted && isPaidMode) {
			// Find the organization for this project
			const organization = userOrgs.find(
				(uo) => uo.organization!.id === project.organizationId,
			)?.organization;

			if (!organization) {
				throw new HTTPException(500, {
					message: "Could not find organization",
				});
			}

			// Always allow switching to hybrid mode for free users
			if (mode === "hybrid") {
				// Hybrid mode is always allowed for free users
			} else if (organization.plan !== "pro") {
				// Only API Keys mode requires pro plan
				throw new HTTPException(403, {
					message:
						"API Keys mode is only available on the Pro plan. Please upgrade to Pro or switch to Credits mode.",
				});
			}
		}

		updateData.mode = mode;
	}

	const [updatedProject] = await db
		.update(tables.project)
		.set(updateData)
		.where(eq(tables.project.id, id))
		.returning();

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

projects.openapi(createProject, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const body = c.req.valid("json");
	const {
		name,
		organizationId,
		cachingEnabled = false,
		cacheDurationSeconds = 60,
		mode = "credits",
	} = body;

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (
		!userOrganization ||
		userOrganization.organization?.status === "deleted"
	) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Check project limits based on plan
	const existingProjects = await db.query.project.findMany({
		where: {
			organizationId: {
				eq: organizationId,
			},
			status: {
				ne: "deleted",
			},
		},
	});

	const projectCount = existingProjects.length;
	const isPro = userOrganization.organization?.plan === "pro";
	const proLimit = 10;
	const freeLimit = 2;
	const projectLimit = isPro ? proLimit : freeLimit;

	if (projectCount >= projectLimit) {
		throw new HTTPException(403, {
			message: isPro
				? `You have reached the limit of ${proLimit} projects for the Pro plan`
				: `You have reached the limit of ${freeLimit} projects for the Free plan. Please upgrade to Pro for up to ${proLimit} projects`,
		});
	}

	const [newProject] = await db
		.insert(tables.project)
		.values({
			name,
			organizationId,
			cachingEnabled,
			cacheDurationSeconds,
			mode,
		})
		.returning();

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

	await db
		.update(tables.project)
		.set({
			status: "deleted",
		})
		.where(eq(tables.project.id, id));

	return c.json({
		message: "Project deleted successfully",
	});
});

export default projects;
