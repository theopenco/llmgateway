import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { computeProfileData, profileSchema } from "@/utils/profile.js";

import { db } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const publicProfile = new OpenAPIHono<ServerTypes>();

const getPublicProfile = createRoute({
	method: "get",
	path: "/{username}",
	request: {
		params: z.object({
			username: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ profile: profileSchema }),
				},
			},
			description: "A public DevPass profile.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Profile not found or not public.",
		},
	},
});

publicProfile.openapi(getPublicProfile, async (c) => {
	const { username } = c.req.valid("param");

	const userRecord = await db.query.user.findFirst({
		where: { username: username.toLowerCase() },
	});

	if (!userRecord || !userRecord.profilePublic) {
		throw new HTTPException(404, { message: "Profile not found" });
	}

	const profile = await computeProfileData(userRecord.id);

	if (!profile || !profile.isPublic) {
		throw new HTTPException(404, { message: "Profile not found" });
	}

	return c.json({ profile }, 200);
});
