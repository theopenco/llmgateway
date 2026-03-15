import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { ServerTypes } from "@/vars.js";

const cookieDomain = process.env.COOKIE_DOMAIN ?? "localhost";
const isProduction = process.env.NODE_ENV === "production";

export const referral = new OpenAPIHono<ServerTypes>();

const REFERRAL_COOKIE_NAME = "llmgateway_referral";
const REFERRAL_COOKIE_DAYS = 30;

const referralRoute = createRoute({
	method: "post",
	path: "/referral",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						ref: z.string().min(1, "Referral code is required"),
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
						success: z.boolean(),
					}),
				},
			},
			description: "Referral cookie set successfully",
		},
	},
});

referral.openapi(referralRoute, async (c) => {
	const { ref } = c.req.valid("json");

	const expires = new Date();
	expires.setDate(expires.getDate() + REFERRAL_COOKIE_DAYS);

	const cookieValue = encodeURIComponent(ref);
	const cookieParts = [
		`${REFERRAL_COOKIE_NAME}=${cookieValue}`,
		`Path=/`,
		`Expires=${expires.toUTCString()}`,
		`SameSite=Lax`,
		`Domain=${cookieDomain}`,
	];

	if (isProduction) {
		cookieParts.push("Secure");
	}

	c.header("Set-Cookie", cookieParts.join("; "));

	return c.json({
		success: true,
	});
});
