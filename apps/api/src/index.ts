// eslint-disable-next-line import/order
import "dotenv/config";

import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { HealthChecker } from "@llmgateway/shared";

import { redisClient } from "./auth/config.js";
import { authHandler } from "./auth/handler.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { beacon } from "./routes/beacon.js";
import { routes } from "./routes/index.js";
import { stripeRoutes } from "./stripe.js";

import type { ServerTypes } from "./vars.js";

export const config = {
	servers: [
		{
			url: "http://localhost:4002",
		},
	],
	openapi: "3.0.0",
	info: {
		version: "1.0.0",
		title: "My API",
	},
};

export const app = new OpenAPIHono<ServerTypes>();

// Add tracing middleware first
app.use("*", tracingMiddleware);

app.use(
	"*",
	cors({
		origin: process.env.ORIGIN_URLS?.split(",") || [
			"http://localhost:3002",
			"http://localhost:3003",
		],
		allowHeaders: ["Content-Type", "Authorization", "Cache-Control"],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "PATCH", "DELETE"],
		exposeHeaders: ["Content-Length"],
		maxAge: 600,
		credentials: true,
	}),
);

app.onError((error, c) => {
	if (error instanceof HTTPException) {
		const status = error.status;

		if (status >= 500) {
			logger.error("HTTPException", error);
		}

		return c.json(
			{
				error: true,
				status,
				message: error.message || "An error occurred",
				...(error.res ? { details: error.res } : {}),
			},
			status,
		);
	}

	// For any other errors (non-HTTPException), return 500 Internal Server Error
	logger.error(
		"Unhandled error",
		error instanceof Error ? error : new Error(String(error)),
	);
	return c.json(
		{
			error: true,
			status: 500,
			message: "Internal Server Error",
		},
		500,
	);
});

const root = createRoute({
	method: "get",
	path: "/",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							message: z.string(),
							version: z.string(),
							health: z.object({
								status: z.string(),
								database: z.object({
									connected: z.boolean(),
									error: z.string().optional(),
								}),
								redis: z.object({
									connected: z.boolean(),
									error: z.string().optional(),
								}),
							}),
						})
						.openapi({}),
				},
			},
			description: "Health check response.",
		},
		503: {
			content: {
				"application/json": {
					schema: z
						.object({
							message: z.string(),
							version: z.string(),
							health: z.object({
								status: z.string(),
								database: z.object({
									connected: z.boolean(),
									error: z.string().optional(),
								}),
								redis: z.object({
									connected: z.boolean(),
									error: z.string().optional(),
								}),
							}),
						})
						.openapi({}),
				},
			},
			description: "Service unavailable - Redis or database connection failed.",
		},
	},
});

app.openapi(root, async (c) => {
	const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 5000;

	const healthChecker = new HealthChecker({
		redisClient,
		db,
		logger,
	});

	const health = await healthChecker.performHealthChecks({
		timeoutMs: TIMEOUT_MS,
	});

	const { response, statusCode } = healthChecker.createHealthResponse(health);

	return c.json(response, statusCode as 200 | 503);
});

app.route("/stripe", stripeRoutes);

app.route("/", beacon);

app.doc("/json", config);

app.get("/docs", swaggerUI({ url: "./json" }));

app.route("/", authHandler);

app.route("/", routes);
