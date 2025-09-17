// eslint-disable-next-line import/order
import "dotenv/config";

import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { anthropic } from "./anthropic/anthropic.js";
import { chat } from "./chat/chat.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { models } from "./models/route.js";

import type { ServerTypes } from "./vars.js";

export const config = {
	servers: [
		{
			url: "https://api.llmgateway.io",
		},
		{
			url: "http://localhost:4001",
		},
	],
	openapi: "3.0.0",
	info: {
		version: "1.0.0",
		title: "LLMGateway API",
	},
	externalDocs: {
		url: "https://docs.llmgateway.io",
		description: "LLMGateway Documentation",
	},
	components: {
		securitySchemes: {
			bearerAuth: {
				type: "http",
				scheme: "bearer",
				description: "Bearer token authentication using API keys",
			},
		},
	},
};

export const app = new OpenAPIHono<ServerTypes>();

// Add tracing middleware first
app.use("*", tracingMiddleware);

// Middleware to check for application/json content type on POST requests
app.use("*", async (c, next) => {
	if (c.req.method === "POST") {
		const contentType = c.req.header("Content-Type");
		if (!contentType || !contentType.includes("application/json")) {
			throw new HTTPException(415, {
				message:
					"Unsupported Media Type: Content-Type must be application/json",
			});
		}
	}
	return await next();
});

app.onError((error, c) => {
	if (error instanceof HTTPException) {
		const status = error.status;

		if (status >= 500) {
			logger.error("HTTP 500 exception", error);
		} else {
			logger.warn("HTTP client error", { status, message: error.message });
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
	summary: "Health check",
	description: "Health check endpoint.",
	operationId: "health",
	method: "get",
	path: "/",
	request: {
		query: z.object({
			skip: z.string().optional().openapi({
				description:
					"Comma-separated list of health checks to skip. Options: redis, database",
				example: "redis,database",
			}),
		}),
	},
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
								redis: z.object({
									connected: z.boolean(),
									error: z.string().optional(),
								}),
								database: z.object({
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
								redis: z.object({
									connected: z.boolean(),
									error: z.string().optional(),
								}),
								database: z.object({
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
	const { skip } = c.req.valid("query");
	const skipChecks = skip
		? skip.split(",").map((s) => s.trim().toLowerCase())
		: [];

	const health = {
		status: "ok",
		redis: { connected: false, error: undefined as string | undefined },
		database: { connected: false, error: undefined as string | undefined },
	};

	const TIMEOUT_MS = Number(process.env.TIMEOUT_MS) || 5000;

	// Helper function to add timeout to promises
	const withTimeout = <T>(
		promise: Promise<T>,
		timeoutMs: number,
	): Promise<T> => {
		const timeoutPromise = new Promise<T>((_, reject) => {
			setTimeout(
				() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)),
				timeoutMs,
			);
		});
		return Promise.race([promise, timeoutPromise]);
	};

	// Run health checks in parallel
	const healthChecks = await Promise.allSettled([
		// Redis check
		skipChecks.includes("redis")
			? Promise.resolve({ type: "redis" as const, skipped: true })
			: withTimeout(
					redisClient
						.ping()
						.then(() => ({ type: "redis" as const, success: true })),
					TIMEOUT_MS,
				),
		// Database check
		skipChecks.includes("database")
			? Promise.resolve({ type: "database" as const, skipped: true })
			: withTimeout(
					db.query.user
						.findFirst({})
						.then(() => ({ type: "database" as const, success: true })),
					TIMEOUT_MS,
				),
	]);

	// Process results
	for (const result of healthChecks) {
		if (result.status === "fulfilled") {
			const check = result.value;
			if ("skipped" in check && check.skipped) {
				// Set as connected when skipped
				if (check.type === "redis") {
					health.redis.connected = true;
				}
				if (check.type === "database") {
					health.database.connected = true;
				}
			} else if ("success" in check && check.success) {
				// Set as connected when successful
				if (check.type === "redis") {
					health.redis.connected = true;
				}
				if (check.type === "database") {
					health.database.connected = true;
				}
			}
		} else {
			// Handle failures
			const errorMessage =
				result.reason instanceof Error
					? result.reason.message
					: String(result.reason);

			// Determine which check failed based on the error or order
			// Since we know the order: [redis, database]
			const checkIndex = healthChecks.indexOf(result);
			if (checkIndex === 0) {
				// Redis check failed
				health.status = "error";
				health.redis.error = errorMessage.includes("timed out")
					? "Redis check timed out"
					: "Redis connection failed";
				logger.error("Redis healthcheck failed", result.reason);
			} else if (checkIndex === 1) {
				// Database check failed
				health.status = "error";
				health.database.error = errorMessage.includes("timed out")
					? "Database check timed out"
					: "Database connection failed";
				logger.error("Database healthcheck failed", result.reason);
			}
		}
	}

	const statusCode = health.status === "error" ? 503 : 200;

	// Set appropriate message based on health status
	let message = "OK";
	if (health.status === "error") {
		const failedSystems: string[] = [];
		if (health.redis.error) {
			failedSystems.push("Redis");
		}
		if (health.database.error) {
			failedSystems.push("Database");
		}

		if (failedSystems.length > 0) {
			message = `Service Unavailable - ${failedSystems.join(", ")} ${failedSystems.length === 1 ? "is" : "are"} unavailable`;
		} else {
			message = "Service Unavailable";
		}
	}

	return c.json(
		{
			message,
			version: process.env.APP_VERSION || "v0.0.0-unknown",
			health,
		},
		statusCode,
	);
});

const v1 = new OpenAPIHono<ServerTypes>();

v1.route("/chat", chat);
v1.route("/models", models);
v1.route("/messages", anthropic);

app.route("/v1", v1);

app.doc("/json", config);

app.get("/docs", swaggerUI({ url: "/json" }));
