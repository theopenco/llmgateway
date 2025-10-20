import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db, eq, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const team = new OpenAPIHono<ServerTypes>();

const roleSchema = z.enum(["owner", "admin", "developer"]);

const teamMemberSchema = z.object({
	id: z.string(),
	userId: z.string(),
	role: roleSchema,
	createdAt: z.date(),
	user: z.object({
		id: z.string(),
		email: z.string(),
		name: z.string().nullable(),
	}),
});

const addMemberSchema = z.object({
	email: z.string().email(),
	role: roleSchema,
});

const updateMemberSchema = z.object({
	role: roleSchema,
});

const getMembers = createRoute({
	method: "get",
	path: "/{organizationId}/members",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						members: z.array(teamMemberSchema).openapi({}),
					}),
				},
			},
			description: "List of team members in the organization",
		},
	},
});

team.openapi(getMembers, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	const members = await db.query.userOrganization.findMany({
		where: {
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: {
				columns: {
					id: true,
					email: true,
					name: true,
				},
			},
		},
	});

	return c.json({
		members: members.map((m) => ({
			id: m.id,
			userId: m.userId,
			role: m.role,
			createdAt: m.createdAt,
			user: m.user!,
		})),
	});
});

const addMember = createRoute({
	method: "post",
	path: "/{organizationId}/members",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: addMemberSchema,
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
						member: teamMemberSchema.openapi({}),
					}),
				},
			},
			description: "Member added successfully",
		},
	},
});

team.openapi(addMember, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();
	const { email, role } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (
		process.env.PAID_MODE === "true" &&
		userOrganization.organization?.plan !== "pro"
	) {
		throw new HTTPException(403, {
			message: "Team management is only available on the Pro plan",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can add members",
		});
	}

	if (userOrganization.role === "admin" && role === "owner") {
		throw new HTTPException(403, {
			message: "Only owners can add other owners",
		});
	}

	const targetUser = await db.query.user.findFirst({
		where: {
			email: {
				eq: email,
			},
		},
	});

	if (!targetUser) {
		throw new HTTPException(404, {
			message: "User not found. Please ask them to create an account first.",
		});
	}

	const existingMember = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: targetUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (existingMember) {
		throw new HTTPException(400, {
			message: "User is already a member of this organization",
		});
	}

	const [newMember] = await db
		.insert(tables.userOrganization)
		.values({
			userId: targetUser.id,
			organizationId,
			role,
		})
		.returning();

	return c.json({
		message: "Member added successfully",
		member: {
			id: newMember.id,
			userId: newMember.userId,
			role: newMember.role,
			createdAt: newMember.createdAt,
			user: {
				id: targetUser.id,
				email: targetUser.email,
				name: targetUser.name,
			},
		},
	});
});

const updateMember = createRoute({
	method: "patch",
	path: "/{organizationId}/members/{memberId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateMemberSchema,
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
						member: teamMemberSchema.openapi({}),
					}),
				},
			},
			description: "Member role updated successfully",
		},
	},
});

team.openapi(updateMember, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId } = c.req.param();
	const { role } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (
		process.env.PAID_MODE === "true" &&
		userOrganization.organization?.plan !== "pro"
	) {
		throw new HTTPException(403, {
			message: "Team management is only available on the Pro plan",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can update member roles",
		});
	}

	const targetMember = await db.query.userOrganization.findFirst({
		where: {
			id: {
				eq: memberId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			user: {
				columns: {
					id: true,
					email: true,
					name: true,
				},
			},
		},
	});

	if (!targetMember) {
		throw new HTTPException(404, {
			message: "Member not found",
		});
	}

	if (userOrganization.role === "admin" && targetMember.role === "owner") {
		throw new HTTPException(403, {
			message: "Admins cannot modify owner roles",
		});
	}

	if (userOrganization.role === "admin" && role === "owner") {
		throw new HTTPException(403, {
			message: "Only owners can grant owner role",
		});
	}

	if (targetMember.role === "owner") {
		const ownerCount = await db.query.userOrganization.findMany({
			where: {
				organizationId: {
					eq: organizationId,
				},
				role: {
					eq: "owner",
				},
			},
		});

		if (ownerCount.length === 1) {
			throw new HTTPException(400, {
				message: "Cannot change role of the last owner",
			});
		}
	}

	const [updatedMember] = await db
		.update(tables.userOrganization)
		.set({ role })
		.where(eq(tables.userOrganization.id, memberId))
		.returning();

	return c.json({
		message: "Member role updated successfully",
		member: {
			id: updatedMember.id,
			userId: updatedMember.userId,
			role: updatedMember.role,
			createdAt: updatedMember.createdAt,
			user: targetMember.user!,
		},
	});
});

const removeMember = createRoute({
	method: "delete",
	path: "/{organizationId}/members/{memberId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			memberId: z.string(),
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
			description: "Member removed successfully",
		},
	},
});

team.openapi(removeMember, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId, memberId } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: {
				eq: authUser.id,
			},
			organizationId: {
				eq: organizationId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (
		process.env.PAID_MODE === "true" &&
		userOrganization.organization?.plan !== "pro"
	) {
		throw new HTTPException(403, {
			message: "Team management is only available on the Pro plan",
		});
	}

	if (userOrganization.role !== "owner" && userOrganization.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can remove members",
		});
	}

	const targetMember = await db.query.userOrganization.findFirst({
		where: {
			id: {
				eq: memberId,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (!targetMember) {
		throw new HTTPException(404, {
			message: "Member not found",
		});
	}

	if (userOrganization.role === "admin" && targetMember.role === "owner") {
		throw new HTTPException(403, {
			message: "Admins cannot remove owners",
		});
	}

	if (targetMember.role === "owner") {
		const ownerCount = await db.query.userOrganization.findMany({
			where: {
				organizationId: {
					eq: organizationId,
				},
				role: {
					eq: "owner",
				},
			},
		});

		if (ownerCount.length === 1) {
			throw new HTTPException(400, {
				message: "Cannot remove the last owner",
			});
		}
	}

	await db
		.delete(tables.userOrganization)
		.where(eq(tables.userOrganization.id, memberId));

	return c.json({
		message: "Member removed successfully",
	});
});

export default team;
