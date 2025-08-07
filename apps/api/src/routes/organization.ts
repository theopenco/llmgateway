import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { db, eq, tables } from "@llmgateway/db";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ServerTypes } from "../vars";

export const organization = new OpenAPIHono<ServerTypes>();

// Define schemas directly with Zod instead of using createSelectSchema
const organizationSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	credits: z.string(),
	plan: z.enum(["free", "pro"]),
	planExpiresAt: z.date().nullable(),
	retentionLevel: z.enum(["retain", "none"]),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	autoTopUpEnabled: z.boolean(),
	autoTopUpThreshold: z.string().nullable(),
	autoTopUpAmount: z.string().nullable(),
});

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

const createOrganizationSchema = z.object({
	name: z.string().min(1).max(255),
});

const updateOrganizationSchema = z.object({
	name: z.string().min(1).max(255).optional(),
	retentionLevel: z.enum(["retain", "none"]).optional(),
	autoTopUpEnabled: z.boolean().optional(),
	autoTopUpThreshold: z.number().min(5).optional(),
	autoTopUpAmount: z.number().min(10).optional(),
});

const transactionSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	organizationId: z.string(),
	type: z.enum([
		"subscription_start",
		"subscription_cancel",
		"subscription_end",
		"credit_topup",
	]),
	amount: z.string().nullable(),
	creditAmount: z.string().nullable(),
	currency: z.string(),
	status: z.enum(["pending", "completed", "failed"]),
	stripePaymentIntentId: z.string().nullable(),
	stripeInvoiceId: z.string().nullable(),
	description: z.string().nullable(),
});

const getOrganizations = createRoute({
	method: "get",
	path: "/",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organizations: z.array(organizationSchema).openapi({}),
					}),
				},
			},
			description: "List of organizations the user belongs to",
		},
	},
});

organization.openapi(getOrganizations, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganizations = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const organizations = userOrganizations
		.map((uo) => uo.organization!)
		.filter((org) => org.status !== "deleted");

	return c.json({
		organizations,
	});
});

const getProjects = createRoute({
	method: "get",
	path: "/{id}/projects",
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
						projects: z.array(projectSchema).openapi({}),
					}),
				},
			},
			description: "List of projects for the specified organization",
		},
	},
});

organization.openapi(getProjects, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: id,
			},
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const projects = await db.query.project.findMany({
		where: {
			organizationId: {
				eq: id,
			},
			status: {
				ne: "deleted",
			},
		},
	});

	return c.json({
		projects,
	});
});

const createOrganization = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createOrganizationSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organization: organizationSchema.openapi({}),
					}),
				},
			},
			description: "Organization created successfully.",
		},
	},
});

organization.openapi(createOrganization, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { name } = c.req.valid("json");

	// Get user's existing organizations to check limits
	const userOrganizations = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	// Filter out deleted organizations
	const activeOrganizations = userOrganizations
		.filter((uo) => uo.organization?.status !== "deleted")
		.map((uo) => uo.organization!);

	const orgsLimit = 3;

	// If user only has free plan, they can have only 1 organization
	if (activeOrganizations.length >= orgsLimit) {
		throw new HTTPException(403, {
			message: `You have reached the limit of ${orgsLimit} organizations. Please reach out to support to increase this limit.`,
		});
	}

	const [newOrganization] = await db
		.insert(tables.organization)
		.values({
			name,
		})
		.returning();

	await db.insert(tables.userOrganization).values({
		userId: user.id,
		organizationId: newOrganization.id,
	});

	await db.insert(tables.project).values({
		name: "Default Project",
		organizationId: newOrganization.id,
		mode: "hybrid",
	});

	return c.json({
		organization: newOrganization,
	});
});

const updateOrganization = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateOrganizationSchema,
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
						organization: organizationSchema.openapi({}),
					}),
				},
			},
			description: "Organization updated successfully.",
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
			description: "Organization not found.",
		},
	},
});

organization.openapi(updateOrganization, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const {
		name,
		retentionLevel,
		autoTopUpEnabled,
		autoTopUpThreshold,
		autoTopUpAmount,
	} = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: id,
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
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const updateData: any = {};
	if (name !== undefined) {
		updateData.name = name;
	}
	if (retentionLevel !== undefined) {
		updateData.retentionLevel = retentionLevel;
	}
	if (autoTopUpEnabled !== undefined) {
		updateData.autoTopUpEnabled = autoTopUpEnabled;
	}
	if (autoTopUpThreshold !== undefined) {
		updateData.autoTopUpThreshold = autoTopUpThreshold.toString();
	}
	if (autoTopUpAmount !== undefined) {
		updateData.autoTopUpAmount = autoTopUpAmount.toString();
	}

	const [updatedOrganization] = await db
		.update(tables.organization)
		.set(updateData)
		.where(eq(tables.organization.id, id))
		.returning();

	return c.json({
		message: "Organization updated successfully",
		organization: updatedOrganization,
	});
});

const deleteOrganization = createRoute({
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
			description: "Organization deleted successfully.",
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
			description: "Organization not found.",
		},
	},
});

organization.openapi(deleteOrganization, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: id,
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
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	await db
		.update(tables.organization)
		.set({
			status: "deleted",
		})
		.where(eq(tables.organization.id, id));

	return c.json({
		message: "Organization deleted successfully",
	});
});

const getTransactions = createRoute({
	method: "get",
	path: "/{id}/transactions",
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
						transactions: z.array(transactionSchema).openapi({}),
					}),
				},
			},
			description: "List of transactions for the specified organization",
		},
	},
});

organization.openapi(getTransactions, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: id,
			},
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const transactions = await db.query.transaction.findMany({
		where: {
			organizationId: {
				eq: id,
			},
		},
		orderBy: {
			createdAt: "desc",
		},
	});

	return c.json({
		transactions,
	});
});

export default organization;
