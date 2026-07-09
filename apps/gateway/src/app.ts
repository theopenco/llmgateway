// eslint-disable-next-line import/order
import "dotenv/config";

import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	InvalidFileContentError,
	RequestError,
	UnsupportedAudioFormatError,
	UnsupportedDocumentFormatError,
} from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db";
import {
	createHonoRequestLogger,
	createRequestLifecycleMiddleware,
} from "@llmgateway/instrumentation";
import { logger, toError } from "@llmgateway/logger";
import { HealthChecker } from "@llmgateway/shared";

import { anthropic } from "./anthropic/anthropic.js";
import { chat } from "./chat/chat.js";
import { embeddingsRoute } from "./embeddings/route.js";
import { imagesRoute } from "./images/route.js";
import {
	buildAnthropicErrorBody,
	buildOpenAIErrorBody,
} from "./lib/error-response.js";
import { mcpHandler, registerMcpOAuthRoutes } from "./mcp/mcp.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { models } from "./models/route.js";
import { moderationsRoute } from "./moderations/route.js";
import { ocrRoute } from "./ocr/route.js";
import { responses } from "./responses/responses.js";
import { speechRoute } from "./speech/route.js";
import { videosRoute } from "./videos/route.js";

import type { ServerTypes } from "./vars.js";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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
// Excludes /v1/images endpoints which accept multipart/form-data for file uploads
app.use("*", async (c, next) => {
	if (
		c.req.method === "POST" &&
		!c.req.path.startsWith("/mcp") &&
		!c.req.path.startsWith("/oauth") &&
		!c.req.path.startsWith("/v1/images")
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

// Renders a gateway-level error in a provider-compatible shape. The Anthropic
// `/v1/messages` endpoint expects Anthropic's `{ type: "error", error: {...} }`
// envelope; every other (OpenAI-compatible) endpoint expects OpenAI's
// `{ error: { message, type, param, code } }` envelope.
function renderGatewayError(
	c: Context<ServerTypes>,
	status: number,
	message: string,
) {
	const jsonStatus = status as ContentfulStatusCode;
	if (c.req.path.startsWith("/v1/messages")) {
		return c.json(buildAnthropicErrorBody({ message, status }), jsonStatus);
	}
	return c.json(buildOpenAIErrorBody({ message, status }), jsonStatus);
}

app.onError((error, c) => {
	if (error instanceof UnsupportedAudioFormatError) {
		logger.warn("Unsupported audio format", {
			message: error.message,
			format: error.format,
			providerTarget: error.providerTarget,
		});
		return renderGatewayError(c, 400, error.message);
	}

	if (error instanceof InvalidFileContentError) {
		logger.warn("Invalid file content", { message: error.message });
		return renderGatewayError(c, 400, error.message);
	}

	if (error instanceof UnsupportedDocumentFormatError) {
		logger.warn("Unsupported document format", {
			message: error.message,
			mimeType: error.mimeType,
			providerTarget: error.providerTarget,
		});
		return renderGatewayError(c, 400, error.message);
	}

	if (error instanceof RequestError) {
		logger.warn("Invalid request", {
			message: error.message,
			statusCode: error.statusCode,
		});
		return renderGatewayError(c, error.statusCode, error.message);
	}

	if (error instanceof HTTPException) {
		const status = error.status;

		// 502/503/504 are upstream/gateway conditions (e.g. a provider
		// terminating the connection), not application bugs. They are already
		// recorded as request logs via insertLog by the chat handler, so log
		// them at warn level instead of error to avoid alerting noise.
		if (status === 502 || status === 503 || status === 504) {
			logger.warn("Upstream gateway error", {
				status,
				message: error.message,
			});
		} else if (status >= 500) {
			logger.error("HTTP 500 exception", error);
		} else {
			logger.warn("HTTP client error", { status, message: error.message });
		}

		return renderGatewayError(c, status, error.message || "An error occurred");
	}

	// Handle timeout errors (from AbortSignal.timeout) - these are expected
	// operational errors when upstream providers are slow, not application bugs
	if (error instanceof Error && error.name === "TimeoutError") {
		logger.warn("Request timeout", {
			message: error.message,
			path: c.req.path,
			method: c.req.method,
		});
		return renderGatewayError(c, 504, "Gateway Timeout");
	}

	// Handle client disconnection (AbortError) - the client closed the
	// connection before the response was sent. Not an application error.
	if (error instanceof Error && error.name === "AbortError") {
		logger.info("Request aborted by client", {
			message: error.message,
			path: c.req.path,
			method: c.req.method,
		});
		return renderGatewayError(c, 499, "Client Closed Request");
	}

	// For any other errors (non-HTTPException), return 500 Internal Server Error
	logger.error("Unhandled error", toError(error));
	return renderGatewayError(c, 500, "Internal Server Error");
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

const v1 = new OpenAPIHono<ServerTypes>();

v1.route("/chat", chat);
v1.route("/embeddings", embeddingsRoute);
v1.route("/images", imagesRoute);
v1.route("/models", models);
v1.route("/moderations", moderationsRoute);
v1.route("/ocr", ocrRoute);
v1.route("/messages", anthropic);
v1.route("/responses", responses);
v1.route("/audio/speech", speechRoute);
v1.route("/videos", videosRoute);

app.route("/v1", v1);

// MCP endpoint - Model Context Protocol server
app.all("/mcp", mcpHandler);

// Register MCP OAuth routes for Claude Code authentication workaround
// This adds OAuth endpoints at /.well-known/oauth-authorization-server and /oauth/*
registerMcpOAuthRoutes(app);

app.doc("/json", config);

app.get("/docs", swaggerUI({ url: "/json" }));

// The gateway is an API, not a website: keep search engines from crawling and
// indexing its endpoints (GSC keeps reporting api.llmgateway.io URLs).
app.get("/robots.txt", (c) => {
	return c.text("User-agent: *\nDisallow: /\n");
});
