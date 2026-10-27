import { z } from "@hono/zod-openapi";
import { getCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { createRoute } from "@/utils/create-route.js";
import {
	isImageVariant,
	renderImageVariant,
} from "@/utils/image-derivatives.js";
import { awardLoungePoints } from "@/utils/lounge-points.js";
import { buildOrgHistoryFilter } from "@/utils/org-history-filter.js";
import { getOrCreateChatOrg } from "@/utils/personal-org.js";
import {
	getOrCreatePlaygroundApiKey,
	PLAYGROUND_KEY_COOKIE_NAME,
	setPlaygroundKeyCookie,
} from "@/utils/playground-key.js";
import { createRouter } from "@/utils/router.js";

import { db, tables, desc, eq, and, sql } from "@llmgateway/db";
import {
	DECISION_IMAGE_DATA_URL_PATTERN,
	DECISION_IMAGE_MEDIA_TYPES,
	MAX_DECISION_CHOICES,
	MAX_DECISION_IMAGE_DATA_URL_LENGTH,
	MAX_DECISION_INPUT_IMAGES,
	MAX_DECISION_LEVELS,
	MAX_DECISION_MODELS,
	MAX_DECISION_QUESTIONS,
} from "@llmgateway/shared/decision-studio";
import { mergeVideoModelResults } from "@llmgateway/shared/video-generation-config";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

const playground = createRouter<ServerTypes>();

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
					schema: z.object({
						ok: z.boolean(),
						token: z.string(),
						expiresIn: z.number().int().positive(),
					}),
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

	const { token, cookieMaxAge } = await getOrCreatePlaygroundApiKey(
		projectId,
		user.id,
		getCookie(c, PLAYGROUND_KEY_COOKIE_NAME),
	);

	// Set httpOnly cookie for playground API key (API domain)
	setPlaygroundKeyCookie(c, token, cookieMaxAge);

	return c.json({ ok: true, token, expiresIn: cookieMaxAge });
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
	const cookie = getCookie(c, PLAYGROUND_KEY_COOKIE_NAME);
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
// served per item by GET /image-history/{id}, and as binary variants by the
// thumbnail, images and input-images endpoints.
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
	inputImageCount: z.number(),
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

const decisionChoiceValueSchema = z.union([z.string(), z.boolean()]);

const decisionQuestionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("predicate"),
		name: z.string(),
		instructions: z.string(),
	}),
	z.object({
		type: z.literal("choice"),
		name: z.string(),
		instructions: z.string(),
		choices: z
			.array(
				z.object({ value: z.string(), description: z.string().optional() }),
			)
			.min(2)
			.max(MAX_DECISION_CHOICES),
	}),
	z.object({
		type: z.literal("score"),
		name: z.string(),
		instructions: z.string(),
		levels: z
			.array(
				z.object({ label: z.string(), description: z.string().optional() }),
			)
			.min(2)
			.max(MAX_DECISION_LEVELS),
	}),
]);

const decisionAnswerSchema = z.object({
	type: z.enum(["predicate", "choice", "score", "refusal"]),
	name: z.string().nullable().optional(),
	probability: z.number().optional(),
	choice: decisionChoiceValueSchema.optional(),
	score: z.number().optional(),
	probabilities: z
		.array(
			z.object({
				value: z.union([z.string(), z.boolean(), z.number()]),
				label: z.string().optional(),
				probability: z.number(),
			}),
		)
		.optional(),
	confidence: z.number().optional(),
});

const decisionUsageSchema = z.object({
	input_tokens: z.number(),
	output_tokens: z.number(),
	total_tokens: z.number(),
});

const decisionModelResultSchema = z.object({
	modelId: z.string(),
	modelName: z.string(),
	answers: z.array(decisionAnswerSchema).nullable(),
	usage: decisionUsageSchema.nullable().optional(),
	error: z.string().optional(),
});

const decisionInputImageSchema = z.object({
	dataUrl: z
		.string()
		.max(MAX_DECISION_IMAGE_DATA_URL_LENGTH)
		.regex(DECISION_IMAGE_DATA_URL_PATTERN),
	mediaType: z.enum(DECISION_IMAGE_MEDIA_TYPES),
});

// The list leaves the base64 input images out; the detail route returns them.
const decisionHistoryListItemSchema = z.object({
	id: z.string(),
	prompt: z.string(),
	title: z.string().nullable(),
	createdAt: z.string(),
	inputImageCount: z.number(),
	questions: z.array(decisionQuestionSchema),
	models: z.array(decisionModelResultSchema),
});

const decisionHistoryItemSchema = decisionHistoryListItemSchema.extend({
	inputImages: z.array(decisionInputImageSchema).nullable(),
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
			inputImageCount: sql<number>`case when jsonb_typeof(${tables.playgroundImageHistory.inputImages}) = 'array' then jsonb_array_length(${tables.playgroundImageHistory.inputImages}) else 0 end`,
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
			inputImageCount: row.inputImageCount,
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
// Serves the first generated image downscaled for sidebar rows so the list
// endpoint can stay free of base64 payloads.

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

	if (notModified(c, `"${row.id}:thumbnail"`)) {
		return c.body(null, 304);
	}
	const rendered = await renderImageVariant(image, "thumbnail");
	c.header("Content-Type", rendered.mediaType);
	return c.body(rendered.body);
});

// Stored images never change, but a cached copy must still pass the ownership
// check above on every use, so the browser revalidates and gets a 304 instead
// of a re-rendered variant.
function notModified(c: Context, etag: string): boolean {
	c.header("Cache-Control", "private, no-cache");
	c.header("ETag", etag);
	return c.req.header("if-none-match") === etag;
}

function parseImageIndex(value: string): number {
	const index = Number(value);
	if (!Number.isInteger(index) || index < 0) {
		throw new HTTPException(400, { message: "Invalid index" });
	}
	return index;
}

function parseImageVariant(value: string | undefined) {
	if (value === undefined) {
		return "full" as const;
	}
	if (!isImageVariant(value)) {
		throw new HTTPException(400, { message: "Invalid variant" });
	}
	return value;
}

// ── GET /image-history/:id/images/:modelIndex/:imageIndex ────────────────────
// Serves one generated image as binary. `variant=thumbnail|preview` returns a
// downscaled WebP for grids and rows; the default `full` variant returns the
// original bytes for zoom, download and reuse as a reference image.

playground.get(
	"/image-history/:id/images/:modelIndex/:imageIndex",
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}

		const id = c.req.param("id");
		const modelIndex = parseImageIndex(c.req.param("modelIndex"));
		const imageIndex = parseImageIndex(c.req.param("imageIndex"));
		const variant = parseImageVariant(c.req.query("variant"));

		const row = await db.query.playgroundImageHistory.findFirst({
			where: { id: { eq: id }, userId: { eq: user.id } },
		});

		if (!row) {
			throw new HTTPException(404, { message: "Not found" });
		}

		const image = row.models[modelIndex]?.images[imageIndex];
		if (!image) {
			throw new HTTPException(404, { message: "No image available" });
		}

		if (notModified(c, `"${row.id}:${modelIndex}:${imageIndex}:${variant}"`)) {
			return c.body(null, 304);
		}
		const rendered = await renderImageVariant(image, variant);
		c.header("Content-Type", rendered.mediaType);
		return c.body(rendered.body);
	},
);

// ── GET /image-history/:id/input-images/:index ───────────────────────────────
// Serves a reference image the user attached to the generation, matching the
// `inputImageCount` returned by the list endpoint.

playground.get("/image-history/:id/input-images/:index", async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const id = c.req.param("id");
	const index = parseImageIndex(c.req.param("index"));
	const variant = parseImageVariant(c.req.query("variant"));

	const row = await db.query.playgroundImageHistory.findFirst({
		where: { id: { eq: id }, userId: { eq: user.id } },
	});

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	const input = row.inputImages?.[index];
	if (!input) {
		throw new HTTPException(404, { message: "No input image available" });
	}

	if (notModified(c, `"${row.id}:input:${index}:${variant}"`)) {
		return c.body(null, 304);
	}
	const rendered = await renderImageVariant(
		{ base64: input.dataUrl.split(",")[1] ?? "", mediaType: input.mediaType },
		variant,
	);
	c.header("Content-Type", rendered.mediaType);
	return c.body(rendered.body);
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

	if (body.models.some((m) => !m.error)) {
		await awardLoungePoints(user.id, "image_generation");
	}

	return c.json(
		{
			item: {
				id: row.id,
				prompt: row.prompt,
				createdAt: row.createdAt.toISOString(),
				inputImageCount: body.inputImages?.length ?? 0,
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

	if (body.models.some((m) => !m.error)) {
		await awardLoungePoints(user.id, "audio_generation");
	}

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

// ── GET /decision-history ────────────────────────────────────────────────────

const listDecisionHistory = createRoute({
	method: "get",
	path: "/decision-history",
	request: {
		query: z.object({
			organizationId: z.string().trim().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						items: z.array(decisionHistoryListItemSchema),
					}),
				},
			},
			description:
				"List of decision runs for the authenticated user, without the base64 input image payloads",
		},
	},
});

// The columns the list view needs; `inputImages` is reduced to a count in
// SQL so the base64 payloads never leave Postgres for the list.
const decisionHistoryListColumns = {
	id: tables.playgroundDecisionHistory.id,
	prompt: tables.playgroundDecisionHistory.prompt,
	title: tables.playgroundDecisionHistory.title,
	createdAt: tables.playgroundDecisionHistory.createdAt,
	inputImageCount: sql<number>`case when jsonb_typeof(${tables.playgroundDecisionHistory.inputImages}) = 'array' then jsonb_array_length(${tables.playgroundDecisionHistory.inputImages}) else 0 end`,
	questions: tables.playgroundDecisionHistory.questions,
	models: tables.playgroundDecisionHistory.models,
};

function serializeDecisionHistoryListItem(row: {
	id: string;
	prompt: string;
	title: string | null;
	createdAt: Date;
	inputImageCount: number;
	questions: (typeof tables.playgroundDecisionHistory.$inferSelect)["questions"];
	models: (typeof tables.playgroundDecisionHistory.$inferSelect)["models"];
}) {
	return {
		id: row.id,
		prompt: row.prompt,
		title: row.title ?? null,
		createdAt: row.createdAt.toISOString(),
		inputImageCount: Number(row.inputImageCount),
		questions: row.questions,
		models: row.models,
	};
}

function serializeDecisionHistory(
	row: typeof tables.playgroundDecisionHistory.$inferSelect,
) {
	return {
		...serializeDecisionHistoryListItem({
			...row,
			inputImageCount: row.inputImages?.length ?? 0,
		}),
		inputImages: row.inputImages ?? null,
	};
}

// A run can only be filed under an organization the user belongs to; the
// Chat plan context is represented by a null organizationId.
async function assertDecisionHistoryOrganization(
	userId: string,
	organizationId: string | undefined,
): Promise<void> {
	if (!organizationId) {
		return;
	}
	const membership = await db.query.userOrganization.findFirst({
		where: { userId: { eq: userId }, organizationId: { eq: organizationId } },
	});
	if (!membership) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}
}

playground.openapi(listDecisionHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");
	const orgFilter = await buildOrgHistoryFilter(
		tables.playgroundDecisionHistory.organizationId,
		organizationId,
	);

	const rows = await db
		.select(decisionHistoryListColumns)
		.from(tables.playgroundDecisionHistory)
		.where(and(eq(tables.playgroundDecisionHistory.userId, user.id), orgFilter))
		.orderBy(desc(tables.playgroundDecisionHistory.createdAt));

	return c.json({ items: rows.map(serializeDecisionHistoryListItem) });
});

// ── GET /decision-history/:id ────────────────────────────────────────────────

const getDecisionHistory = createRoute({
	method: "get",
	path: "/decision-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: decisionHistoryItemSchema }),
				},
			},
			description: "One decision run including its input images",
		},
	},
});

playground.openapi(getDecisionHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const row = await db.query.playgroundDecisionHistory.findFirst({
		where: { id: { eq: id }, userId: { eq: user.id } },
	});
	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({ item: serializeDecisionHistory(row) });
});

// ── POST /decision-history ───────────────────────────────────────────────────

const saveDecisionHistory = createRoute({
	method: "post",
	path: "/decision-history",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							// Empty when the run was images only.
							prompt: z.string().max(100_000),
							organizationId: z.string().trim().min(1).optional(),
							inputImages: z
								.array(decisionInputImageSchema)
								.max(MAX_DECISION_INPUT_IMAGES)
								.optional(),
							questions: z
								.array(decisionQuestionSchema)
								.min(1)
								.max(MAX_DECISION_QUESTIONS),
							models: z
								.array(decisionModelResultSchema)
								.min(1)
								.max(MAX_DECISION_MODELS),
						})
						.refine(
							(body) =>
								body.prompt.trim().length > 0 || !!body.inputImages?.length,
							{
								message: "A run needs text or at least one image",
								path: ["prompt"],
							},
						),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ item: decisionHistoryItemSchema }),
				},
			},
			description: "Saved decision run",
		},
	},
});

playground.openapi(saveDecisionHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");
	await assertDecisionHistoryOrganization(user.id, body.organizationId);

	const [row] = await db
		.insert(tables.playgroundDecisionHistory)
		.values({
			userId: user.id,
			organizationId: body.organizationId ?? null,
			prompt: body.prompt,
			inputImages: body.inputImages ?? null,
			questions: body.questions,
			models: body.models,
		})
		.returning();

	if (body.models.some((m) => !m.error && m.answers)) {
		await awardLoungePoints(user.id, "decision_run");
	}

	return c.json({ item: serializeDecisionHistory(row) }, 201);
});

// ── DELETE /decision-history/:id ─────────────────────────────────────────────

const deleteDecisionHistory = createRoute({
	method: "delete",
	path: "/decision-history/{id}",
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

playground.openapi(deleteDecisionHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.playgroundDecisionHistory)
		.where(
			and(
				eq(tables.playgroundDecisionHistory.id, id),
				eq(tables.playgroundDecisionHistory.userId, user.id),
			),
		)
		.returning({ id: tables.playgroundDecisionHistory.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({ message: "Deleted" });
});

// ── PATCH /decision-history/:id ──────────────────────────────────────────────

const renameDecisionHistory = createRoute({
	method: "patch",
	path: "/decision-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ title: z.string().trim().min(1).max(200) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: decisionHistoryItemSchema }),
				},
			},
			description: "Renamed decision run",
		},
	},
});

playground.openapi(renameDecisionHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const { title } = c.req.valid("json");

	const [row] = await db
		.update(tables.playgroundDecisionHistory)
		.set({ title })
		.where(
			and(
				eq(tables.playgroundDecisionHistory.id, id),
				eq(tables.playgroundDecisionHistory.userId, user.id),
			),
		)
		.returning();

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({ item: serializeDecisionHistory(row) });
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

	// Items are saved at submission with pending models; points land on the
	// PATCH that records the first finished video.
	if (body.models.some((m) => m.videoUrl)) {
		await awardLoungePoints(user.id, "video_generation");
	}

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

const updateVideoHistory = createRoute({
	method: "patch",
	path: "/video-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							prompt: z.string().min(1).optional(),
							// Full replacement of the item's model results, sent as jobs
							// finish or fail after the item was saved at submission.
							models: z.array(videoModelResultSchema).min(1).optional(),
						})
						.refine(
							(body) => body.prompt !== undefined || body.models !== undefined,
							{ message: "prompt or models is required" },
						),
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

playground.openapi(updateVideoHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const { prompt, models } = c.req.valid("json");

	// Live and resumed pollers each send whole snapshots and can race, so the
	// row is locked while its snapshot is merged: a settled result is never
	// overwritten by a stale pending one.
	const { row, firstFinishedVideo } = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(tables.playgroundVideoHistory)
			.where(
				and(
					eq(tables.playgroundVideoHistory.id, id),
					eq(tables.playgroundVideoHistory.userId, user.id),
				),
			)
			.for("update")
			.limit(1);
		if (!existing) {
			throw new HTTPException(404, { message: "Not found" });
		}

		const mergedModels = models
			? mergeVideoModelResults(existing.models, models)
			: undefined;
		const [updated] = await tx
			.update(tables.playgroundVideoHistory)
			.set({
				...(prompt !== undefined && { prompt }),
				...(mergedModels && { models: mergedModels }),
			})
			.where(eq(tables.playgroundVideoHistory.id, id))
			.returning({
				id: tables.playgroundVideoHistory.id,
				prompt: tables.playgroundVideoHistory.prompt,
				createdAt: tables.playgroundVideoHistory.createdAt,
			});
		return {
			row: updated,
			// Awarded once per item, when its first finished video is recorded.
			firstFinishedVideo:
				mergedModels !== undefined &&
				!existing.models.some((m) => m.videoUrl) &&
				mergedModels.some((m) => m.videoUrl),
		};
	});

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	if (firstFinishedVideo) {
		await awardLoungePoints(user.id, "video_generation");
	}

	return c.json({
		item: {
			id: row.id,
			prompt: row.prompt,
			createdAt: row.createdAt.toISOString(),
		},
	});
});

// ── Realtime (voice call) history ────────────────────────────────────────────

const realtimeTranscriptEntrySchema = z.object({
	role: z.enum(["user", "assistant"]),
	text: z.string(),
	status: z.enum(["partial", "final", "interrupted"]),
	timestamp: z.number(),
	// Assistant speech for the turn as a base64 WAV, so a saved call can be
	// listened to and not just read.
	audio: z
		.object({
			base64: z.string().max(48_000_000),
			mediaType: z.literal("audio/wav"),
		})
		.optional(),
});

const realtimeUsageSchema = z.object({
	responses: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	audioInputTokens: z.number(),
	audioOutputTokens: z.number(),
});

// Lightweight list representation: the transcript itself is only fetched when
// a call is opened, so the sidebar never downloads every conversation.
const realtimeHistoryListItemSchema = z.object({
	id: z.string(),
	title: z.string(),
	createdAt: z.string(),
	model: z.string(),
	voice: z.string().nullable(),
	durationSeconds: z.number(),
	turnCount: z.number(),
});

const realtimeHistoryItemSchema = realtimeHistoryListItemSchema.extend({
	transcript: z.array(realtimeTranscriptEntrySchema),
	usage: realtimeUsageSchema.nullable(),
});

// ── GET /realtime-history ────────────────────────────────────────────────────

const listRealtimeHistory = createRoute({
	method: "get",
	path: "/realtime-history",
	request: {
		query: z.object({
			organizationId: z.string().trim().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						items: z.array(realtimeHistoryListItemSchema),
					}),
				},
			},
			description:
				"List of realtime voice call history for the authenticated user, without transcripts",
		},
	},
});

playground.openapi(listRealtimeHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.valid("query");
	const orgFilter = await buildOrgHistoryFilter(
		tables.playgroundRealtimeHistory.organizationId,
		organizationId,
	);

	// Count the turns in SQL so the transcripts stay in Postgres.
	const rows = await db
		.select({
			id: tables.playgroundRealtimeHistory.id,
			title: tables.playgroundRealtimeHistory.title,
			createdAt: tables.playgroundRealtimeHistory.createdAt,
			model: tables.playgroundRealtimeHistory.model,
			voice: tables.playgroundRealtimeHistory.voice,
			durationSeconds: tables.playgroundRealtimeHistory.durationSeconds,
			turnCount: sql<number>`coalesce(jsonb_array_length(${tables.playgroundRealtimeHistory.transcript}), 0)`,
		})
		.from(tables.playgroundRealtimeHistory)
		.where(and(eq(tables.playgroundRealtimeHistory.userId, user.id), orgFilter))
		.orderBy(desc(tables.playgroundRealtimeHistory.createdAt));

	return c.json({
		items: rows.map((row) => ({
			id: row.id,
			title: row.title,
			createdAt: row.createdAt.toISOString(),
			model: row.model,
			voice: row.voice ?? null,
			durationSeconds: row.durationSeconds,
			turnCount: Number(row.turnCount),
		})),
	});
});

// ── GET /realtime-history/:id ────────────────────────────────────────────────

const getRealtimeHistoryItem = createRoute({
	method: "get",
	path: "/realtime-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: realtimeHistoryItemSchema }),
				},
			},
			description: "Realtime voice call including its full transcript",
		},
	},
});

playground.openapi(getRealtimeHistoryItem, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const [row] = await db
		.select()
		.from(tables.playgroundRealtimeHistory)
		.where(
			and(
				eq(tables.playgroundRealtimeHistory.id, id),
				eq(tables.playgroundRealtimeHistory.userId, user.id),
			),
		);

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({
		item: {
			id: row.id,
			title: row.title,
			createdAt: row.createdAt.toISOString(),
			model: row.model,
			voice: row.voice ?? null,
			durationSeconds: row.durationSeconds,
			turnCount: row.transcript.length,
			transcript: row.transcript,
			usage: row.usage ?? null,
		},
	});
});

// ── POST /realtime-history ───────────────────────────────────────────────────

const saveRealtimeHistory = createRoute({
	method: "post",
	path: "/realtime-history",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						title: z.string().trim().min(1).max(200),
						organizationId: z.string().trim().min(1).optional(),
						model: z.string().min(1),
						voice: z.string().optional(),
						durationSeconds: z.number().int().min(0).optional(),
						transcript: z.array(realtimeTranscriptEntrySchema).min(1),
						usage: realtimeUsageSchema.optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ item: realtimeHistoryListItemSchema }),
				},
			},
			description: "Saved realtime voice call",
		},
	},
});

playground.openapi(saveRealtimeHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const body = c.req.valid("json");

	const [row] = await db
		.insert(tables.playgroundRealtimeHistory)
		.values({
			userId: user.id,
			organizationId: body.organizationId ?? null,
			title: body.title,
			model: body.model,
			voice: body.voice ?? null,
			durationSeconds: body.durationSeconds ?? 0,
			transcript: body.transcript,
			usage: body.usage ?? null,
		})
		.returning({
			id: tables.playgroundRealtimeHistory.id,
			title: tables.playgroundRealtimeHistory.title,
			createdAt: tables.playgroundRealtimeHistory.createdAt,
			model: tables.playgroundRealtimeHistory.model,
			voice: tables.playgroundRealtimeHistory.voice,
			durationSeconds: tables.playgroundRealtimeHistory.durationSeconds,
		});

	return c.json(
		{
			item: {
				id: row.id,
				title: row.title,
				createdAt: row.createdAt.toISOString(),
				model: row.model,
				voice: row.voice ?? null,
				durationSeconds: row.durationSeconds,
				turnCount: body.transcript.length,
			},
		},
		201,
	);
});

// ── PATCH /realtime-history/:id ──────────────────────────────────────────────

// Renames a call, and/or grows it with the turns of a continued session: a
// resumed call appends to the row it continued rather than starting a new one,
// so one conversation stays one history entry.
const updateRealtimeHistory = createRoute({
	method: "patch",
	path: "/realtime-history/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							title: z.string().trim().min(1).max(200).optional(),
							appendTranscript: z
								.array(realtimeTranscriptEntrySchema)
								.min(1)
								.optional(),
							addDurationSeconds: z.number().int().min(0).optional(),
							addUsage: realtimeUsageSchema.optional(),
						})
						.refine(
							(body) =>
								Object.values(body).some((value) => value !== undefined),
							{ message: "At least one field must be provided" },
						),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ item: realtimeHistoryListItemSchema }),
				},
			},
			description: "Updated realtime voice call",
		},
	},
});

playground.openapi(updateRealtimeHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	// Appending needs the current transcript/duration/usage, so this is a
	// read-modify-write. The row lock serializes two continuations of the same
	// call finishing at once (e.g. from two tabs), so the later one appends to
	// the earlier one's result instead of overwriting it from a stale read.
	const row = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select()
			.from(tables.playgroundRealtimeHistory)
			.where(
				and(
					eq(tables.playgroundRealtimeHistory.id, id),
					eq(tables.playgroundRealtimeHistory.userId, user.id),
				),
			)
			.for("update");

		if (!existing) {
			throw new HTTPException(404, { message: "Not found" });
		}

		const addUsage = body.addUsage;
		const previousUsage = existing.usage;

		const [updated] = await tx
			.update(tables.playgroundRealtimeHistory)
			.set({
				...(body.title !== undefined ? { title: body.title } : {}),
				...(body.appendTranscript
					? { transcript: [...existing.transcript, ...body.appendTranscript] }
					: {}),
				...(body.addDurationSeconds !== undefined
					? {
							durationSeconds:
								existing.durationSeconds + body.addDurationSeconds,
						}
					: {}),
				...(addUsage
					? {
							usage: {
								responses: (previousUsage?.responses ?? 0) + addUsage.responses,
								inputTokens:
									(previousUsage?.inputTokens ?? 0) + addUsage.inputTokens,
								outputTokens:
									(previousUsage?.outputTokens ?? 0) + addUsage.outputTokens,
								totalTokens:
									(previousUsage?.totalTokens ?? 0) + addUsage.totalTokens,
								audioInputTokens:
									(previousUsage?.audioInputTokens ?? 0) +
									addUsage.audioInputTokens,
								audioOutputTokens:
									(previousUsage?.audioOutputTokens ?? 0) +
									addUsage.audioOutputTokens,
							},
						}
					: {}),
			})
			.where(eq(tables.playgroundRealtimeHistory.id, existing.id))
			.returning();

		return updated;
	});

	if (!row) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({
		item: {
			id: row.id,
			title: row.title,
			createdAt: row.createdAt.toISOString(),
			model: row.model,
			voice: row.voice ?? null,
			durationSeconds: row.durationSeconds,
			turnCount: row.transcript.length,
		},
	});
});

// ── DELETE /realtime-history/:id ─────────────────────────────────────────────

const deleteRealtimeHistory = createRoute({
	method: "delete",
	path: "/realtime-history/{id}",
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

playground.openapi(deleteRealtimeHistory, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.playgroundRealtimeHistory)
		.where(
			and(
				eq(tables.playgroundRealtimeHistory.id, id),
				eq(tables.playgroundRealtimeHistory.userId, user.id),
			),
		)
		.returning({ id: tables.playgroundRealtimeHistory.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Not found" });
	}

	return c.json({ message: "Deleted" });
});

export default playground;
