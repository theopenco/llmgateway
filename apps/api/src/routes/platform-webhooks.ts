import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { platformSecretAuth } from "@/lib/platform-secret-auth.js";

import { db, eq, shortid, tables } from "@llmgateway/db";
import { assertSafeWebhookUrl } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

/**
 * LLM SDK — manage developer webhook endpoints (platform secret key
 * auth). LLM Gateway POSTs signed events (wallet.credited, wallet.low_balance)
 * to these. The signing secret is returned only once, at creation.
 */
export const platformWebhooks = new OpenAPIHono<ServerTypes>();

platformWebhooks.use("*", platformSecretAuth);

// Webhook endpoints are project-level config shared across modes (the rows have
// no live/test mode and deliveries go to the developer's real consumers), so a
// test key must not list/create/delete them — otherwise a sandbox key could
// disrupt live event delivery. Reject test mode outright.
platformWebhooks.use("*", async (c, next) => {
	const platformKey = c.get("platformKey");
	if (platformKey?.mode === "test") {
		throw new HTTPException(403, {
			message:
				"Webhook endpoints cannot be managed with a test secret key. Use a live secret key.",
		});
	}
	await next();
});

const KNOWN_EVENTS = ["wallet.credited", "wallet.low_balance"] as const;

const endpointSchema = z.object({
	id: z.string(),
	url: z.string(),
	enabledEvents: z.array(z.string()).nullable(),
	status: z.enum(["active", "disabled"]),
	createdAt: z.string(),
});

const createEndpoint = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						url: z.string().url(),
						enabledEvents: z.array(z.enum(KNOWN_EVENTS)).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: endpointSchema.extend({ secret: z.string() }),
				},
			},
			description:
				"Webhook endpoint created. `secret` is returned only once — store it to verify signatures.",
		},
	},
});

platformWebhooks.openapi(createEndpoint, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { url, enabledEvents } = c.req.valid("json");

	// SSRF guard: reject non-https and private/reserved/internal destinations
	// up-front (the worker re-validates + resolves DNS at delivery time).
	try {
		assertSafeWebhookUrl(url);
	} catch (err) {
		throw new HTTPException(400, {
			message: err instanceof Error ? err.message : "Invalid webhook URL",
		});
	}

	const secret = `whsec_${shortid(40)}`;

	const [endpoint] = await db
		.insert(tables.webhookEndpoint)
		.values({
			organizationId: platformKey.organizationId,
			projectId: platformKey.projectId,
			url,
			secret,
			enabledEvents: enabledEvents ?? null,
		})
		.returning();

	return c.json(
		{
			id: endpoint.id,
			url: endpoint.url,
			enabledEvents: endpoint.enabledEvents,
			status: endpoint.status,
			createdAt: endpoint.createdAt.toISOString(),
			secret,
		},
		201,
	);
});

const listEndpoints = createRoute({
	method: "get",
	path: "/",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ endpoints: z.array(endpointSchema) }),
				},
			},
			description: "List webhook endpoints for the project (without secrets).",
		},
	},
});

platformWebhooks.openapi(listEndpoints, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const endpoints = await db.query.webhookEndpoint.findMany({
		where: { projectId: { eq: platformKey.projectId } },
		orderBy: { createdAt: "desc" },
	});

	return c.json({
		endpoints: endpoints.map((e) => ({
			id: e.id,
			url: e.url,
			enabledEvents: e.enabledEvents,
			status: e.status,
			createdAt: e.createdAt.toISOString(),
		})),
	});
});

const deleteEndpoint = createRoute({
	method: "delete",
	path: "/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Webhook endpoint deleted.",
		},
	},
});

platformWebhooks.openapi(deleteEndpoint, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const existing = await db.query.webhookEndpoint.findFirst({
		where: { id: { eq: id }, projectId: { eq: platformKey.projectId } },
	});
	if (!existing) {
		throw new HTTPException(404, {
			message: "Webhook endpoint not found in this project",
		});
	}

	await db
		.delete(tables.webhookEndpoint)
		.where(eq(tables.webhookEndpoint.id, id));

	return c.json({ message: "Webhook endpoint deleted" });
});

export default platformWebhooks;
