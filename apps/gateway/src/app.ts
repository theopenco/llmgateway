// eslint-disable-next-line import/order
import "dotenv/config";

import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db";
import {
	createHonoRequestLogger,
	createRequestLifecycleMiddleware,
	getMetrics,
	getMetricsContentType,
} from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";
import { HealthChecker } from "@llmgateway/shared";

import { anthropic } from "./anthropic/anthropic.js";
import { chat } from "./chat/chat.js";
import { imagesRoute } from "./images/route.js";
import { mcpHandler, registerMcpOAuthRoutes } from "./mcp/mcp.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { models } from "./models/route.js";
import { responses } from "./responses/responses.js";

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

const honoRequestLogger = createHonoRequestLogger({ service: "gateway" });

const requestLifecycleMiddleware = createRequestLifecycleMiddleware({
	serviceName: "llmgateway-gateway-lifecycle",
});

// Add tracing middleware first so instrumentation stays active for downstream handlers
app.use("*", tracingMiddleware);
app.use("*", requestLifecycleMiddleware);
app.use("*", honoRequestLogger);

app.use(
	"*",
	cors({
		origin: "*",
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"Cache-Control",
			"x-api-key",
			"mcp-session-id",
		],
		allowMethods: ["POST", "GET", "OPTIONS", "PUT", "PATCH", "DELETE"],
		exposeHeaders: ["Content-Length", "mcp-session-id"],
		maxAge: 600,
	}),
);

// Middleware to check for application/json content type on POST requests
// Excludes /mcp endpoint which handles its own content type validation
// Excludes /oauth endpoints which accept form-urlencoded or JSON
app.use("*", async (c, next) => {
	if (
		c.req.method === "POST" &&
		!c.req.path.startsWith("/mcp") &&
		!c.req.path.startsWith("/oauth")
	) {
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

	// Handle timeout errors (from AbortSignal.timeout) - these are expected
	// operational errors when upstream providers are slow, not application bugs
	if (error instanceof Error && error.name === "TimeoutError") {
		logger.warn("Request timeout", {
			message: error.message,
			path: c.req.path,
			method: c.req.method,
		});
		return c.json(
			{
				error: true,
				status: 504,
				message: "Gateway Timeout",
			},
			504,
		);
	}

	// Handle client disconnection (AbortError) - the client closed the
	// connection before the response was sent. Not an application error.
	if (error instanceof Error && error.name === "AbortError") {
		logger.info("Request aborted by client", {
			message: error.message,
			path: c.req.path,
			method: c.req.method,
		});
		return c.json(
			{
				error: true,
				status: 499,
				message: "Client Closed Request",
			},
			499 as any,
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

	// By default, skip database health check for gateway since it uses cached db client
	// and can operate without direct Postgres connectivity as long as Redis is available
	const skipDatabase = process.env.HEALTH_CHECK_SKIP_DATABASE !== "false";
	if (skipDatabase && !skipChecks.includes("database")) {
		skipChecks.push("database");
	}

	// Health check timeout - allow more time under load for DB/Redis connections
	// 15 seconds default to prevent false failures during traffic spikes
	const TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 15000;

	const healthChecker = new HealthChecker({
		redisClient,
		db,
		logger,
	});

	const health = await healthChecker.performHealthChecks({
		skipChecks,
		timeoutMs: TIMEOUT_MS,
	});

	const { response, statusCode } = healthChecker.createHealthResponse(health);

	return c.json(response, statusCode as 200 | 503);
});

// Prometheus metrics endpoint
const metricsRoute = createRoute({
	summary: "Prometheus metrics",
	description: "Prometheus metrics endpoint for scraping.",
	operationId: "metrics",
	method: "get",
	path: "/metrics",
	responses: {
		200: {
			content: {
				"text/plain": {
					schema: z.string(),
				},
			},
			description: "Prometheus metrics in exposition format.",
		},
	},
});

app.openapi(metricsRoute, async (c) => {
	const metrics = await getMetrics();
	return c.text(metrics, 200, {
		"Content-Type": getMetricsContentType(),
	});
});

const v1 = new OpenAPIHono<ServerTypes>();

v1.route("/chat", chat);
v1.route("/images", imagesRoute);
v1.route("/models", models);
v1.route("/messages", anthropic);
v1.route("/responses", responses);

app.route("/v1", v1);

// MCP endpoint - Model Context Protocol server
app.all("/mcp", mcpHandler);

// Register MCP OAuth routes for Claude Code authentication workaround
// This adds OAuth endpoints at /.well-known/oauth-authorization-server and /oauth/*
registerMcpOAuthRoutes(app);

app.doc("/json", config);

app.get("/docs", swaggerUI({ url: "/json" }));
