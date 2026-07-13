import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { buildOrgHistoryFilter } from "@/utils/org-history-filter.js";
import { getOrCreateChatOrg } from "@/utils/personal-org.js";

import { db, tables, shortid, desc, eq, and, sql } from "@llmgateway/db";

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

const getChatOrg = createRoute({
	method: "get",
	path: "/chat-org",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string(),
						projectId: z.string(),
					}),
				},
			},
			description:
				"Ensures the user's dedicated Chat organization (and a default project) and returns their ids. This is the playground's billing home.",
		},
	},
});

playground.openapi(getChatOrg, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const chatOrg = await getOrCreateChatOrg(user);

	let project = await db.query.project.findFirst({
		where: {
			organizationId: { eq: chatOrg.id },
			status: { eq: "active" },
		},
	});

	if (!project) {
		[project] = await db
			.insert(tables.project)
			.values({
				name: "Default Project",
				organizationId: chatOrg.id,
				mode: "credits",
			})
			.returning();
	}

	return c.json({ organizationId: chatOrg.id, projectId: project.id });
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

// Lightweight list representation: no base64 payloads. Full image data is
// served per item by GET /image-history/{id} and the thumbnail endpoint.
const imageHistoryListModelSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	imageCount: z.number(),
	error: z.string().optional(),
});

const imageHistoryListItemSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	createdAt: z.string(),
	models: z.array(imageHistoryListModelSchema),
});

const audioModelResultSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	audio: z.object({ base64: z.string(), mediaType: z.string() }).nullable(),
	error: z.string().optional(),
});

const audioHistoryItemSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	createdAt: z.string(),
	voice: z.string().nullable(),
	models: z.array(audioModelResultSchema),
});

const videoModelResultSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	jobId: z.string().nullable(),
	videoUrl: z.string().nullable(),
	expiresAt: z.number().nullable().optional(),
	error: z.string().optional(),
});

// Lightweight list representation: frame/reference input images are not
// inlined as base64. The client builds preview URLs from the boolean/count
// flags pointing at GET /video-history/{id}/input-image/{index}.
const videoHistoryListItemSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	createdAt: z.string(),
	hasStartFrame: z.boolean(),
	hasEndFrame: z.boolean(),
	referenceImageCount: z.number(),
	models: z.array(videoModelResultSchema),
});

// ── GET /image-history ───────────────────────────────────────────────────────

const listImageHistory = createRoute({
	method: "get",
	path: "/image-history",
	request: {
		query: z.object({
			organizationId: z.string().trim().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ items: z.array(imageHistoryListItemSchema) }),
				},
			},
			description:
				"List of image generation history for the authenticated user, without base64 image payloads",
		},
	},
});

playground.openapi(listImageHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");
	const orgFilter = await buildOrgHistoryFilter(
		tables.playgroundImageHistory.organizationId,
		organizationId,
	);

	// Project the models jsonb down to metadata in SQL so the base64 image
	// payloads never leave Postgres for the list view.
	const rows = await db
		.select({
			id: tables.playgroundImageHistory.id,
			prompt: tables.playgroundImageHistory.prompt,
			createdAt: tables.playgroundImageHistory.createdAt,
			models: sql<
				{
					modelId: string;
					modelName: string;
					imageCount: number;
					error: string | null;
				}[]
			>`(
				select coalesce(
					jsonb_agg(
						jsonb_build_object(
							'modelId', m.value ->> 'modelId',
							'modelName', m.value ->> 'modelName',
							'imageCount', coalesce(jsonb_array_length(m.value -> 'images'), 0),
							'error', m.value ->> 'error'
						)
						order by m.ord
					),
					'[]'::jsonb
				)
				from jsonb_array_elements(${tables.playgroundImageHistory.models}) with ordinality as m(value, ord)
			)`,
		})
		.from(tables.playgroundImageHistory)
		.where(and(eq(tables.playgroundImageHistory.userId, user.id), orgFilter))
		.orderBy(desc(tables.playgroundImageHistory.createdAt));

	return c.json({
		items: rows.map((row) => ({
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
			models: row.models.map((m) => ({
				modelId: m.modelId,
				modelName: m.modelName,
				imageCount: m.imageCount,
				...(m.error ? { error: m.error } : {}),
			})),
		})),
	});
});

// ── GET /image-history/:id ───────────────────────────────────────────────────

const getImageHistoryItem = createRoute({
	method: "get",
	path: "/image-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: imageHistoryItemSchema }),
				},
			},
			description: "Full image history item including base64 image data",
		},
	},
});

playground.openapi(getImageHistoryItem, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const row = await db.query.playgroundImageHistory.findFirst({
		where: { id: { eq: id }, userId: { eq: user.id } },
	});

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

// ── GET /image-history/:id/thumbnail ─────────────────────────────────────────
// Serves the first generated image as binary for sidebar thumbnails so the
// list endpoint can stay free of base64 payloads. Items are immutable, hence
// the aggressive cache header.

playground.get("/image-history/:id/thumbnail", async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const id = c.req.param("id");

	const row = await db.query.playgroundImageHistory.findFirst({
		where: { id: { eq: id }, userId: { eq: user.id } },
	});

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	const image = row.models.flatMap((m) => m.images)[0];
	if (!image) {
		throw new HTTPException(404, { message: "No image available" });
	}

	c.header("Content-Type", image.mediaType);
	c.header("Cache-Control", "private, max-age=31536000, immutable");
	return c.body(Buffer.from(image.base64, "base64"));
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
						organizationId: z.string().trim().min(1).optional(),
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
					schema: z.object({ item: imageHistoryListItemSchema }),
				},
			},
			description: "Saved image history item (lightweight, no image data)",
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
			organizationId: body.organizationId ?? null,
			prompt: body.prompt,
			inputImages: body.inputImages ?? null,
			models: body.models,
		})
		.returning({
			id: tables.playgroundImageHistory.id,
			prompt: tables.playgroundImageHistory.prompt,
			createdAt: tables.playgroundImageHistory.createdAt,
		});

	return c.json(
		{
			item: {
				id: row.id,
				prompt: row.prompt,
				createdAt: row.createdAt.toISOString(),
				models: body.models.map((m) => ({
					modelId: m.modelId,
					modelName: m.modelName,
					imageCount: m.images.length,
					...(m.error ? { error: m.error } : {}),
				})),
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
					schema: z.object({
						item: z.object({
							id: z.string(),
							prompt: z.string(),
							createdAt: z.string(),
						}),
					}),
				},
			},
			description: "Updated image history item (lightweight)",
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
		.returning({
			id: tables.playgroundImageHistory.id,
			prompt: tables.playgroundImageHistory.prompt,
			createdAt: tables.playgroundImageHistory.createdAt,
		});

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({
		item: {
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
		},
	});
});

// ── GET /audio-history ───────────────────────────────────────────────────────

const listAudioHistory = createRoute({
	method: "get",
	path: "/audio-history",
	request: {
		query: z.object({
			organizationId: z.string().trim().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ items: z.array(audioHistoryItemSchema) }),
				},
			},
			description:
				"List of audio generation history for the authenticated user",
		},
	},
});

playground.openapi(listAudioHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");
	const orgFilter = await buildOrgHistoryFilter(
		tables.playgroundAudioHistory.organizationId,
		organizationId,
	);

	const rows = await db
		.select()
		.from(tables.playgroundAudioHistory)
		.where(and(eq(tables.playgroundAudioHistory.userId, user.id), orgFilter))
		.orderBy(desc(tables.playgroundAudioHistory.createdAt));

	return c.json({
		items: rows.map((row) => ({
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
			voice: row.voice ?? null,
			models: row.models,
		})),
	});
});

// ── POST /audio-history ──────────────────────────────────────────────────────

const saveAudioHistory = createRoute({
	method: "post",
	path: "/audio-history",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						prompt: z.string().min(1),
						organizationId: z.string().trim().min(1).optional(),
						voice: z.string().optional(),
						models: z.array(audioModelResultSchema),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ item: audioHistoryItemSchema }),
				},
			},
			description: "Saved audio history item",
		},
	},
});

playground.openapi(saveAudioHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	const [row] = await db
		.insert(tables.playgroundAudioHistory)
		.values({
			userId: user.id,
			organizationId: body.organizationId ?? null,
			prompt: body.prompt,
			voice: body.voice ?? null,
			models: body.models,
		})
		.returning();

	return c.json(
		{
			item: {
				id: row.id,
				prompt: row.prompt,
				createdAt: row.createdAt.toISOString(),
				voice: row.voice ?? null,
				models: row.models,
			},
		},
		201,
	);
});

// ── DELETE /audio-history/:id ────────────────────────────────────────────────

const deleteAudioHistory = createRoute({
	method: "delete",
	path: "/audio-history/{id}",
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

playground.openapi(deleteAudioHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.playgroundAudioHistory)
		.where(
			and(
				eq(tables.playgroundAudioHistory.id, id),
				eq(tables.playgroundAudioHistory.userId, user.id),
			),
		)
		.returning({ id: tables.playgroundAudioHistory.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({ message: "Deleted" });
});

// ── PATCH /audio-history/:id ─────────────────────────────────────────────────

const renameAudioHistory = createRoute({
	method: "patch",
	path: "/audio-history/{id}",
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
					schema: z.object({ item: audioHistoryItemSchema }),
				},
			},
			description: "Updated audio history item",
		},
	},
});

playground.openapi(renameAudioHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const { prompt } = c.req.valid("json");

	const [row] = await db
		.update(tables.playgroundAudioHistory)
		.set({ prompt })
		.where(
			and(
				eq(tables.playgroundAudioHistory.id, id),
				eq(tables.playgroundAudioHistory.userId, user.id),
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
			voice: row.voice ?? null,
			models: row.models,
		},
	});
});

// ── GET /video-history ───────────────────────────────────────────────────────

const listVideoHistory = createRoute({
	method: "get",
	path: "/video-history",
	request: {
		query: z.object({
			organizationId: z.string().trim().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ items: z.array(videoHistoryListItemSchema) }),
				},
			},
			description:
				"List of video generation history for the authenticated user, without base64 input image payloads",
		},
	},
});

playground.openapi(listVideoHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");
	const orgFilter = await buildOrgHistoryFilter(
		tables.playgroundVideoHistory.organizationId,
		organizationId,
	);

	// frameInputs/referenceImages hold base64 data URLs; only presence flags
	// leave Postgres for the list view. The client builds preview URLs against
	// GET /video-history/{id}/input-image/{index} from these flags.
	const rows = await db
		.select({
			id: tables.playgroundVideoHistory.id,
			prompt: tables.playgroundVideoHistory.prompt,
			createdAt: tables.playgroundVideoHistory.createdAt,
			models: tables.playgroundVideoHistory.models,
			// jsonb_typeof guards: stored frame inputs use explicit JSON nulls
			// ({"start": null}), which `is not null` would misreport as present.
			hasStartFrame: sql<boolean>`coalesce(jsonb_typeof(${tables.playgroundVideoHistory.frameInputs} -> 'start') = 'object', false)`,
			hasEndFrame: sql<boolean>`coalesce(jsonb_typeof(${tables.playgroundVideoHistory.frameInputs} -> 'end') = 'object', false)`,
			referenceImageCount: sql<number>`case when jsonb_typeof(${tables.playgroundVideoHistory.referenceImages}) = 'array' then jsonb_array_length(${tables.playgroundVideoHistory.referenceImages}) else 0 end`,
		})
		.from(tables.playgroundVideoHistory)
		.where(and(eq(tables.playgroundVideoHistory.userId, user.id), orgFilter))
		.orderBy(desc(tables.playgroundVideoHistory.createdAt));

	return c.json({
		items: rows.map((row) => ({
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
			hasStartFrame: row.hasStartFrame,
			hasEndFrame: row.hasEndFrame,
			referenceImageCount: row.referenceImageCount,
			models: row.models,
		})),
	});
});

// ── GET /video-history/:id/input-image/:index ────────────────────────────────
// Serves frame/reference input images as binary for history previews. Index
// enumerates [start frame, end frame, ...reference images] in order, matching
// the flags returned by the list endpoint.

playground.get("/video-history/:id/input-image/:index", async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const id = c.req.param("id");
	const index = Number(c.req.param("index"));
	if (!Number.isInteger(index) || index < 0) {
		throw new HTTPException(400, { message: "Invalid index" });
	}

	const row = await db.query.playgroundVideoHistory.findFirst({
		where: { id: { eq: id }, userId: { eq: user.id } },
	});

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	const inputs = [
		...(row.frameInputs?.start ? [row.frameInputs.start] : []),
		...(row.frameInputs?.end ? [row.frameInputs.end] : []),
		...(row.referenceImages ?? []),
	];
	const input = inputs[index];
	if (!input) {
		throw new HTTPException(404, { message: "No input image available" });
	}

	if (!input.dataUrl.startsWith("data:")) {
		return c.redirect(input.dataUrl);
	}

	const base64 = input.dataUrl.split(",")[1] ?? "";
	c.header("Content-Type", input.mediaType);
	c.header("Cache-Control", "private, max-age=31536000, immutable");
	return c.body(Buffer.from(base64, "base64"));
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
						organizationId: z.string().trim().min(1).optional(),
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
					schema: z.object({ item: videoHistoryListItemSchema }),
				},
			},
			description: "Saved video history item (lightweight, no input images)",
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
			organizationId: body.organizationId ?? null,
			prompt: body.prompt,
			frameInputs: body.frameInputs ?? null,
			referenceImages: body.referenceImages ?? null,
			models: body.models,
		})
		.returning({
			id: tables.playgroundVideoHistory.id,
			prompt: tables.playgroundVideoHistory.prompt,
			createdAt: tables.playgroundVideoHistory.createdAt,
		});

	return c.json(
		{
			item: {
				id: row.id,
				prompt: row.prompt,
				createdAt: row.createdAt.toISOString(),
				hasStartFrame: !!body.frameInputs?.start,
				hasEndFrame: !!body.frameInputs?.end,
				referenceImageCount: body.referenceImages?.length ?? 0,
				models: body.models,
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
					schema: z.object({
						item: z.object({
							id: z.string(),
							prompt: z.string(),
							createdAt: z.string(),
						}),
					}),
				},
			},
			description: "Updated video history item (lightweight)",
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
		.returning({
			id: tables.playgroundVideoHistory.id,
			prompt: tables.playgroundVideoHistory.prompt,
			createdAt: tables.playgroundVideoHistory.createdAt,
		});

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({
		item: {
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
		},
	});
});

export default playground;
