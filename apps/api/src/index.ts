// eslint-disable-next-line import/order
import "dotenv/config";

import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { redisClient } from "./auth/config";
import { authHandler } from "./auth/handler";
import { tracingMiddleware } from "./middleware/tracing";
import { routes } from "./routes";
import { beacon } from "./routes/beacon";
import { stripeRoutes } from "./stripe";

import type { ServerTypes } from "./vars";

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
		origin: process.env.UI_URL || "http://localhost:3002",
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
	},
});

app.openapi(root, async (c) => {
	const health = {
		status: "ok",
		redis: { connected: false, error: undefined as string | undefined },
		database: { connected: false, error: undefined as string | undefined },
	};

	try {
		await db.query.user.findFirst({});
		health.database.connected = true;
	} catch (error) {
		health.status = "error";
		health.database.error = "Database connection failed";
		logger.error(
			"Database healthcheck failed",
			error instanceof Error ? error : new Error(String(error)),
		);
	}

	try {
		await redisClient.ping();
		health.redis.connected = true;
	} catch (error) {
		health.status = "error";
		health.redis.error = "Redis connection failed";
		logger.error(
			"Redis healthcheck failed",
			error instanceof Error ? error : new Error(String(error)),
		);
	}

	return c.json({
		message: "OK",
		version: process.env.APP_VERSION || "v0.0.0-unknown",
		health,
	});
});

app.route("/stripe", stripeRoutes);

app.route("/", beacon);

app.doc("/json", config);

app.get("/docs", swaggerUI({ url: "./json" }));

app.route("/", authHandler);

app.route("/", routes);
