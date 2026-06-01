import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { db, tables, shortid, desc, eq, and } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const COOKIE_NAME = "llmgateway_playground_key";

const playground = new OpenAPIHono<ServerTypes>();

const ensureKey = createRoute({
	method: "post",
	path: "/ensure-key",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						projectId: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ ok: z.boolean(), token: z.string() }),
				},
			},
			description: "Ensured playground key and set cookie",
		},
	},
});

playground.openapi(ensureKey, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { projectId } = c.req.valid("json");

	// Verify project exists
	const project = await db.query.project.findFirst({
		where: { id: { eq: projectId } },
	});
	if (!project) {
		throw new HTTPException(404, { message: "Project not found" });
	}

	// Verify the authenticated user belongs to the organization's project
	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: user.id },
			organizationId: { eq: project.organizationId },
		},
	});

	if (!membership) {
		throw new HTTPException(403, {
			message: "You do not have access to this project's organization",
		});
	}

	// Find any active API key for this project
	let key = await db.query.apiKey.findFirst({
		where: {
			projectId: { eq: projectId },
			status: { eq: "active" },
		},
	});

	if (!key) {
		const prefix =
			process.env.NODE_ENV === "development" ? `llmgdev_` : "llmgtwy_";
		const token = prefix + shortid(40);
		[key] = await db
			.insert(tables.apiKey)
			.values({
				token,
				projectId,
				description: "Auto-generated playground key",
				usageLimit: null,
				createdBy: user.id,
			})
			.returning();
	}

	// Set httpOnly cookie for playground API key (API domain)
	setCookie(c, COOKIE_NAME, key.token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "Lax",
		path: "/",
		maxAge: 60 * 60 * 24 * 30, // 30 days
	});

	return c.json({ ok: true, token: key.token });
});

const getKey = createRoute({
	method: "get",
	path: "/key",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ hasKey: z.boolean() }),
				},
			},
			description: "Returns if playground key cookie is present",
		},
	},
});

playground.openapi(getKey, async (c) => {
	const cookie = getCookie(c, COOKIE_NAME);
	return c.json({ hasKey: !!cookie });
});

// ── Shared Zod schemas ──────────────────────────────────────────────────────

const imageModelResultSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	images: z.array(z.object({ base64: z.string(), mediaType: z.string() })),
	error: z.string().optional(),
});

const imageHistoryItemSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	createdAt: z.string(),
	inputImages: z
		.array(z.object({ dataUrl: z.string(), mediaType: z.string() }))
		.nullable(),
	models: z.array(imageModelResultSchema),
});

const videoModelResultSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	jobId: z.string().nullable(),
	videoUrl: z.string().nullable(),
	expiresAt: z.number().nullable().optional(),
	error: z.string().optional(),
});

const videoHistoryItemSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	createdAt: z.string(),
	frameInputs: z
		.object({
			start: z
				.object({ dataUrl: z.string(), mediaType: z.string() })
				.nullable(),
			end: z.object({ dataUrl: z.string(), mediaType: z.string() }).nullable(),
		})
		.nullable(),
	referenceImages: z
		.array(z.object({ dataUrl: z.string(), mediaType: z.string() }))
		.nullable(),
	models: z.array(videoModelResultSchema),
});

// ── GET /image-history ───────────────────────────────────────────────────────

const listImageHistory = createRoute({
	method: "get",
	path: "/image-history",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ items: z.array(imageHistoryItemSchema) }),
				},
			},
			description:
				"List of image generation history for the authenticated user",
		},
	},
});

playground.openapi(listImageHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const rows = await db
		.select()
		.from(tables.playgroundImageHistory)
		.where(eq(tables.playgroundImageHistory.userId, user.id))
		.orderBy(desc(tables.playgroundImageHistory.createdAt));

	return c.json({
		items: rows.map((row) => ({
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
			inputImages: row.inputImages ?? null,
			models: row.models,
		})),
	});
});

// ── POST /image-history ──────────────────────────────────────────────────────

const saveImageHistory = createRoute({
	method: "post",
	path: "/image-history",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						prompt: z.string().min(1),
						inputImages: z
							.array(z.object({ dataUrl: z.string(), mediaType: z.string() }))
							.optional(),
						models: z.array(imageModelResultSchema),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ item: imageHistoryItemSchema }),
				},
			},
			description: "Saved image history item",
		},
	},
});

playground.openapi(saveImageHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	const [row] = await db
		.insert(tables.playgroundImageHistory)
		.values({
			userId: user.id,
			prompt: body.prompt,
			inputImages: body.inputImages ?? null,
			models: body.models,
		})
		.returning();

	return c.json(
		{
			item: {
				id: row.id,
				prompt: row.prompt,
				createdAt: row.createdAt.toISOString(),
				inputImages: row.inputImages ?? null,
				models: row.models,
			},
		},
		201,
	);
});

// ── DELETE /image-history/:id ────────────────────────────────────────────────

const deleteImageHistory = createRoute({
	method: "delete",
	path: "/image-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "Deleted",
		},
	},
});

playground.openapi(deleteImageHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.playgroundImageHistory)
		.where(
			and(
				eq(tables.playgroundImageHistory.id, id),
				eq(tables.playgroundImageHistory.userId, user.id),
			),
		)
		.returning({ id: tables.playgroundImageHistory.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({ message: "Deleted" });
});

// ── PATCH /image-history/:id ─────────────────────────────────────────────────

const renameImageHistory = createRoute({
	method: "patch",
	path: "/image-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ prompt: z.string().min(1) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: imageHistoryItemSchema }),
				},
			},
			description: "Updated image history item",
		},
	},
});

playground.openapi(renameImageHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const { prompt } = c.req.valid("json");

	const [row] = await db
		.update(tables.playgroundImageHistory)
		.set({ prompt })
		.where(
			and(
				eq(tables.playgroundImageHistory.id, id),
				eq(tables.playgroundImageHistory.userId, user.id),
			),
		)
		.returning();

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({
		item: {
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
			inputImages: row.inputImages ?? null,
			models: row.models,
		},
	});
});

// ── GET /video-history ───────────────────────────────────────────────────────

const listVideoHistory = createRoute({
	method: "get",
	path: "/video-history",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ items: z.array(videoHistoryItemSchema) }),
				},
			},
			description:
				"List of video generation history for the authenticated user",
		},
	},
});

playground.openapi(listVideoHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const rows = await db
		.select()
		.from(tables.playgroundVideoHistory)
		.where(eq(tables.playgroundVideoHistory.userId, user.id))
		.orderBy(desc(tables.playgroundVideoHistory.createdAt));

	return c.json({
		items: rows.map((row) => ({
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
			frameInputs: row.frameInputs ?? null,
			referenceImages: row.referenceImages ?? null,
			models: row.models,
		})),
	});
});

// ── POST /video-history ──────────────────────────────────────────────────────

const saveVideoHistory = createRoute({
	method: "post",
	path: "/video-history",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						prompt: z.string().min(1),
						frameInputs: z
							.object({
								start: z
									.object({ dataUrl: z.string(), mediaType: z.string() })
									.nullable(),
								end: z
									.object({ dataUrl: z.string(), mediaType: z.string() })
									.nullable(),
							})
							.optional(),
						referenceImages: z
							.array(z.object({ dataUrl: z.string(), mediaType: z.string() }))
							.optional(),
						models: z.array(videoModelResultSchema),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ item: videoHistoryItemSchema }),
				},
			},
			description: "Saved video history item",
		},
	},
});

playground.openapi(saveVideoHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	const [row] = await db
		.insert(tables.playgroundVideoHistory)
		.values({
			userId: user.id,
			prompt: body.prompt,
			frameInputs: body.frameInputs ?? null,
			referenceImages: body.referenceImages ?? null,
			models: body.models,
		})
		.returning();

	return c.json(
		{
			item: {
				id: row.id,
				prompt: row.prompt,
				createdAt: row.createdAt.toISOString(),
				frameInputs: row.frameInputs ?? null,
				referenceImages: row.referenceImages ?? null,
				models: row.models,
			},
		},
		201,
	);
});

// ── DELETE /video-history/:id ────────────────────────────────────────────────

const deleteVideoHistory = createRoute({
	method: "delete",
	path: "/video-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: z.object({ message: z.string() }) },
			},
			description: "Deleted",
		},
	},
});

playground.openapi(deleteVideoHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.playgroundVideoHistory)
		.where(
			and(
				eq(tables.playgroundVideoHistory.id, id),
				eq(tables.playgroundVideoHistory.userId, user.id),
			),
		)
		.returning({ id: tables.playgroundVideoHistory.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({ message: "Deleted" });
});

// ── PATCH /video-history/:id ─────────────────────────────────────────────────

const renameVideoHistory = createRoute({
	method: "patch",
	path: "/video-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ prompt: z.string().min(1) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: videoHistoryItemSchema }),
				},
			},
			description: "Updated video history item",
		},
	},
});

playground.openapi(renameVideoHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const { prompt } = c.req.valid("json");

	const [row] = await db
		.update(tables.playgroundVideoHistory)
		.set({ prompt })
		.where(
			and(
				eq(tables.playgroundVideoHistory.id, id),
				eq(tables.playgroundVideoHistory.userId, user.id),
			),
		)
		.returning();

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({
		item: {
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
			frameInputs: row.frameInputs ?? null,
			referenceImages: row.referenceImages ?? null,
			models: row.models,
		},
	});
});

export default playground;
