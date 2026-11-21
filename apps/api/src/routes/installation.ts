import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { createRoute } from "@/utils/create-route.js";
import { consumeRateLimit } from "@/utils/public-rate-limit.js";

import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

export const installation = new OpenAPIHono<ServerTypes>();

// The enterprise inquiry endpoint of the hosted service. It emails the address
// a confirmation link before anything reaches the sales team.
const ENTERPRISE_INQUIRY_URL =
	"https://internal.llmgateway.io/public/contact/enterprise";
const REQUEST_TIMEOUT_MS = 10_000;
const REGISTRATIONS_PER_USER_PER_HOUR = 3;
const HOUR_SECONDS = 60 * 60;

const registerSchema = z.object({
	email: z.string().email("Invalid email address").max(254),
	name: z.string().trim().min(2).max(120).optional(),
	size: z.string().trim().min(1).max(40),
	message: z.string().trim().max(2000).optional(),
});

const resultSchema = z.object({ message: z.string() });

const registerRoute = createRoute({
	method: "post",
	path: "/register",
	request: {
		body: { content: { "application/json": { schema: registerSchema } } },
	},
	responses: {
		200: {
			content: { "application/json": { schema: resultSchema } },
			description:
				"The enterprise inquiry was sent; the address receives a confirmation email.",
		},
		404: { description: "Not a self-hosted installation." },
		429: { description: "Too many registrations." },
		502: { description: "The inquiry could not be delivered." },
	},
});

installation.openapi(registerRoute, async (c) => {
	if (process.env.HOSTED === "true") {
		throw new HTTPException(404, { message: "Not found" });
	}
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const body = c.req.valid("json");

	const allowed = await consumeRateLimit(
		`installation_register:${user.id}`,
		REGISTRATIONS_PER_USER_PER_HOUR,
		HOUR_SECONDS,
	);
	if (!allowed) {
		throw new HTTPException(429, {
			message: "Too many registrations. Try again in an hour.",
		});
	}

	const version = process.env.APP_VERSION ?? "unknown";
	const note = `Registered from a self-hosted installation (version ${version}).`;
	let response: Response;
	try {
		response = await fetch(ENTERPRISE_INQUIRY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: body.email,
				name: body.name,
				size: body.size,
				deployment: "self_host",
				message: body.message ? `${note}\n\n${body.message}` : note,
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		logger.warn("Enterprise registration request failed", {
			error: error instanceof Error ? error : new Error(String(error)),
		});
		throw new HTTPException(502, {
			message: "Could not reach LLM Gateway. Check outbound access and retry.",
		});
	}

	if (response.status === 429) {
		throw new HTTPException(429, {
			message: "Too many registrations. Try again in an hour.",
		});
	}
	if (!response.ok) {
		logger.warn("Enterprise registration was rejected", {
			status: response.status,
		});
		throw new HTTPException(502, {
			message:
				"The registration was not accepted. Email contact@llmgateway.io.",
		});
	}

	return c.json({
		message: "Check your inbox to confirm your email address.",
	});
});
