import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getCookie, setCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";

import { db, tables, shortid } from "@llmgateway/db";

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

	// Find an existing API key with description marker
	let key = await db.query.apiKey.findFirst({
		where: {
			projectId: { eq: projectId },
			description: { eq: "Auto-generated playground key" },
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

export default playground;
