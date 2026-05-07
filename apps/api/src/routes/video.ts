import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { userHasOrganizationAccess } from "@/utils/authorization.js";

import { db } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

const TERMINAL_VIDEO_STATUSES = new Set([
	"completed",
	"failed",
	"canceled",
	"expired",
]);

function toUnixTimestamp(date: Date | null): number | null {
	return date ? Math.floor(date.getTime() / 1000) : null;
}

const videoJobResponseSchema = z.object({
	id: z.string(),
	object: z.literal("video"),
	model: z.string(),
	status: z.enum([
		"queued",
		"in_progress",
		"completed",
		"failed",
		"canceled",
		"expired",
	]),
	progress: z.number().nullable(),
	created_at: z.number(),
	completed_at: z.number().nullable(),
	expires_at: z.number().nullable(),
	error: z
		.object({
			code: z.string().optional(),
			message: z.string(),
			details: z.unknown().optional(),
		})
		.nullable(),
});

const getVideoStatus = createRoute({
	method: "get",
	path: "/{videoId}",
	request: {
		params: z.object({
			videoId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: videoJobResponseSchema,
				},
			},
			description: "Video job status",
		},
	},
});

export const video = new OpenAPIHono<ServerTypes>();

video.openapi(getVideoStatus, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { videoId } = c.req.valid("param");

	const job = await db.query.videoJob.findFirst({
		where: {
			id: { eq: videoId },
		},
	});

	if (!job) {
		throw new HTTPException(404, { message: "Video not found" });
	}

	const hasAccess = await userHasOrganizationAccess(
		user.id,
		job.organizationId,
	);
	if (!hasAccess) {
		throw new HTTPException(404, { message: "Video not found" });
	}

	return c.json(
		{
			id: job.id,
			object: "video" as const,
			model: job.model,
			status: job.status,
			progress: TERMINAL_VIDEO_STATUSES.has(job.status)
				? job.status === "completed"
					? 100
					: job.progress
				: job.progress,
			created_at: Math.floor(job.createdAt.getTime() / 1000),
			completed_at: toUnixTimestamp(job.completedAt),
			expires_at: toUnixTimestamp(job.expiresAt),
			error: job.error ?? null,
		},
		200,
	);
});
