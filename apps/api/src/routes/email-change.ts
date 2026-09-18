import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	checkEmailChangeConfirmationRateLimit,
	confirmEmailChange,
} from "@/lib/email-change.js";

export const emailChange = new OpenAPIHono();

emailChange.openapi(
	createRoute({
		method: "post",
		path: "/user/email/confirm",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
					},
				},
			},
		},
		responses: {
			429: {
				description: "Too many confirmation attempts.",
				content: {
					"application/json": { schema: z.object({ message: z.string() }) },
				},
			},
			400: {
				description: "Invalid, expired, or conflicting email change.",
				content: {
					"application/json": { schema: z.object({ message: z.string() }) },
				},
			},
			200: {
				description: "Email confirmed. Sign in again with the new address.",
				content: {
					"application/json": { schema: z.object({ message: z.string() }) },
				},
			},
		},
	}),
	async (c) => {
		await checkEmailChangeConfirmationRateLimit(c.req.raw.headers);
		await confirmEmailChange(c.req.valid("json").token, c.req.raw.headers);
		return c.json({
			message: "Email updated. Sign in with your new email address.",
		});
	},
);
