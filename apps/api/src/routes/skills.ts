import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import { db, tables, eq, and } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const skills = new OpenAPIHono<ServerTypes>();

const skillSchema = z.object({
	id: z.string(),
	name: z.string(),
	description: z.string(),
	instructions: z.string(),
	enabled: z.boolean(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

const createSkillSchema = z.object({
	name: z.string().min(1).max(100),
	description: z.string().max(2000),
	instructions: z.string().min(1),
	enabled: z.boolean().optional().default(true),
});

const updateSkillSchema = z.object({
	name: z.string().min(1).max(100).optional(),
	description: z.string().max(2000).optional(),
	instructions: z.string().min(1).optional(),
	enabled: z.boolean().optional(),
});

const listSkills = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						skills: z.array(skillSchema),
					}),
				},
			},
			description: "List of user's skills",
		},
	},
});

skills.openapi(listSkills, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const rows = await db.query.skill.findMany({
		where: { userId: { eq: user.id } },
		orderBy: (t, { desc }) => [desc(t.createdAt)],
	});

	return c.json({
		skills: rows.map((s) => ({
			id: s.id,
			name: s.name,
			description: s.description,
			instructions: s.instructions,
			enabled: s.enabled,
			createdAt: s.createdAt.toISOString(),
			updatedAt: s.updatedAt.toISOString(),
		})),
	});
});

const createSkill = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createSkillSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ skill: skillSchema }),
				},
			},
			description: "Created skill",
		},
	},
});

skills.openapi(createSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	const [created] = await db
		.insert(tables.skill)
		.values({
			userId: user.id,
			name: body.name,
			description: body.description,
			instructions: body.instructions,
			enabled: body.enabled ?? true,
		})
		.returning();

	return c.json(
		{
			skill: {
				id: created.id,
				name: created.name,
				description: created.description,
				instructions: created.instructions,
				enabled: created.enabled,
				createdAt: created.createdAt.toISOString(),
				updatedAt: created.updatedAt.toISOString(),
			},
		},
		201,
	);
});

const getSkill = createRoute({
	method: "get",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ skill: skillSchema }),
				},
			},
			description: "Skill details",
		},
	},
});

skills.openapi(getSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const s = await db.query.skill.findFirst({
		where: { id: { eq: id } },
	});

	if (!s) {
		throw new HTTPException(404, { message: "Skill not found" });
	}

	if (s.userId !== user.id) {
		throw new HTTPException(403, { message: "Forbidden" });
	}

	return c.json({
		skill: {
			id: s.id,
			name: s.name,
			description: s.description,
			instructions: s.instructions,
			enabled: s.enabled,
			createdAt: s.createdAt.toISOString(),
			updatedAt: s.updatedAt.toISOString(),
		},
	});
});

const updateSkill = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateSkillSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ skill: skillSchema }),
				},
			},
			description: "Updated skill",
		},
	},
});

skills.openapi(updateSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	const existing = await db.query.skill.findFirst({
		where: { id: { eq: id } },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Skill not found" });
	}

	if (existing.userId !== user.id) {
		throw new HTTPException(403, { message: "Forbidden" });
	}

	const [updated] = await db
		.update(tables.skill)
		.set({
			...(body.name !== undefined ? { name: body.name } : {}),
			...(body.description !== undefined
				? { description: body.description }
				: {}),
			...(body.instructions !== undefined
				? { instructions: body.instructions }
				: {}),
			...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
		})
		.where(and(eq(tables.skill.id, id), eq(tables.skill.userId, user.id)))
		.returning();

	return c.json({
		skill: {
			id: updated.id,
			name: updated.name,
			description: updated.description,
			instructions: updated.instructions,
			enabled: updated.enabled,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
		},
	});
});

const deleteSkill = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Skill deleted",
		},
	},
});

skills.openapi(deleteSkill, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const existing = await db.query.skill.findFirst({
		where: { id: { eq: id } },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Skill not found" });
	}

	if (existing.userId !== user.id) {
		throw new HTTPException(403, { message: "Forbidden" });
	}

	await db
		.delete(tables.skill)
		.where(and(eq(tables.skill.id, id), eq(tables.skill.userId, user.id)));

	return c.json({ success: true });
});
