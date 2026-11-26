import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { userHasOrganizationAccess } from "@/utils/authorization.js";
import { createRoute } from "@/utils/create-route.js";

import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	buildSignedGatewayVideoLogContentUrl,
	buildSignedGatewayVideoJobContentUrl,
} from "@llmgateway/shared/video-access";

import type { ServerTypes } from "@/vars.js";

const TERMINAL_VIDEO_STATUSES = new Set([
	"completed",
	"failed",
	"canceled",
	"expired",
]);

const RESULT_LOG_GRACE_MS = 2 * 60 * 1000;

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
	content: z
		.array(
			z.object({
				type: z.literal("video"),
				url: z.string(),
				mime_type: z.string().nullable().optional(),
			}),
		)
		.optional(),
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

	// Signing failures affect playback, not the terminal generation status.
	let content:
		{ type: "video"; url: string; mime_type?: string | null }[] | undefined;
	if (
		job.status === "completed" &&
		(job.logId || hasUnsettledVideoBilling(job))
	) {
		try {
			content = [
				{
					type: "video" as const,
					url: job.logId
						? buildSignedGatewayVideoLogContentUrl(job.logId)
						: buildSignedGatewayVideoJobContentUrl(job.id),
					mime_type: job.contentType ?? null,
				},
			];
		} catch (error) {
			logger.error("Failed to sign video content URL", {
				videoId: job.id,
				logId: job.logId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	// The worker commits `completed` before it writes the result log that
	// playback is served from. Until that log exists the job is not playable,
	// so report it as still finishing; otherwise a poller that lands in that
	// gap treats the job as done and its player fails until the page reloads.
	// The worker retries finalization every tick, so the gap is normally
	// seconds; past the grace window the terminal status wins, so a job whose
	// log keeps failing cannot hold pollers on "in progress".
	const awaitingResultLog =
		job.status === "completed" &&
		!job.logId &&
		!hasUnsettledVideoBilling(job) &&
		Date.now() - (job.completedAt ?? job.createdAt).getTime() <
			RESULT_LOG_GRACE_MS;

	return c.json(
		{
			id: job.id,
			object: "video" as const,
			model: job.model,
			status: awaitingResultLog ? ("in_progress" as const) : job.status,
			progress: awaitingResultLog
				? 99
				: TERMINAL_VIDEO_STATUSES.has(job.status)
					? job.status === "completed"
						? 100
						: job.progress
					: job.progress,
			created_at: Math.floor(job.createdAt.getTime() / 1000),
			completed_at: awaitingResultLog ? null : toUnixTimestamp(job.completedAt),
			expires_at: toUnixTimestamp(job.expiresAt),
			error: job.error ?? null,
			content,
		},
		200,
	);
});
function hasUnsettledVideoBilling(job: {
	usedProvider: string;
	upstreamStatusResponse: unknown;
}): boolean {
	const status = job.upstreamStatusResponse;
	return (
		job.usedProvider === "bytedance" &&
		!!status &&
		typeof status === "object" &&
		(("llmgateway_billing_pending" in status &&
			status.llmgateway_billing_pending === true) ||
			("llmgateway_billing_quarantined" in status &&
				status.llmgateway_billing_quarantined === true))
	);
}
