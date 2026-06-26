// eslint-disable-next-line import/order
import "dotenv/config";

import { swaggerUI } from "@hono/swagger-ui";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db } from "@llmgateway/db";
import {
	createHonoRequestLogger,
	createRequestLifecycleMiddleware,
} from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";
import { HealthChecker } from "@llmgateway/shared";

import { redisClient } from "./auth/config.js";
import { authHandler } from "./auth/handler.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { beacon } from "./routes/beacon.js";
import { routes } from "./routes/index.js";
import { internalModels } from "./routes/internal-models.js";
import { platformConnect } from "./routes/platform-connect.js";
import { platformCustomers } from "./routes/platform-customers.js";
import { platformSessionRefresh } from "./routes/platform-session-refresh.js";
import { platformSessions } from "./routes/platform-sessions.js";
import { platformWallet } from "./routes/platform-wallet.js";
import { platformWebhooks } from "./routes/platform-webhooks.js";
import { publicApps } from "./routes/public-apps.js";
import { publicChatShares } from "./routes/public-chat-shares.js";
import { publicChatSupport } from "./routes/public-chat-support.js";
import { publicConfig } from "./routes/public-config.js";
import { publicContact } from "./routes/public-contact.js";
import { publicDiscounts } from "./routes/public-discounts.js";
import { publicLeaderboard } from "./routes/public-leaderboard.js";
import { publicModelRatings } from "./routes/public-model-ratings.js";
import { publicNewsletter } from "./routes/public-newsletter.js";
import { publicProfile } from "./routes/public-profile.js";
import { publicProvidersStats } from "./routes/public-providers-stats.js";
import { referral } from "./routes/referral.js";
import { v1Master } from "./routes/v1-master.js";
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

const honoRequestLogger = createHonoRequestLogger({ service: "api" });

const requestLifecycleMiddleware = createRequestLifecycleMiddleware({
	serviceName: "llmgateway-api-lifecycle",
});

// Add tracing middleware first so instrumentation stays active for downstream handlers
app.use("*", tracingMiddleware);
app.use("*", requestLifecycleMiddleware);
app.use("*", honoRequestLogger);

const corsAllowList = process.env.ORIGIN_URLS?.split(",") ?? [
	"http://localhost:3002",
	"http://localhost:3003",
	"http://localhost:3004",
	"http://localhost:3005",
	"http://localhost:3006",
];

// LLM SDK endpoints are called cross-origin from arbitrary developer
// frontends with a bearer session token (no cookies), so they reflect the
// request origin. The per-project `allowedOrigins` allowlist is enforced
// server-side in the end-user session middleware / gateway handler.
const EMBEDDABLE_CORS_PREFIXES = ["/v1/wallet", "/v1/sessions", "/v1/config"];

app.use(
	"*",
	cors({
		origin: (origin, c) => {
			if (!origin) {
				return corsAllowList[0];
			}
			if (corsAllowList.includes(origin)) {
				return origin;
			}
			if (EMBEDDABLE_CORS_PREFIXES.some((p) => c.req.path.startsWith(p))) {
				return origin;
			}
			return corsAllowList[0];
		},
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"Cache-Control",
			"x-api-key",
		],
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

	// Handle timeout errors - expected operational errors, not application bugs
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

	// Handle client disconnection
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

app.route("/", referral);

app.route("/internal", internalModels);

app.route("/public/discounts", publicDiscounts);
app.route("/public/contact", publicContact);
app.route("/public/newsletter", publicNewsletter);
app.route("/public/chat-support", publicChatSupport);
app.route("/public/chats/share", publicChatShares);
app.route("/public/apps", publicApps);
app.route("/public/profile", publicProfile);
app.route("/public/leaderboard", publicLeaderboard);
app.route("/public/providers/stats", publicProvidersStats);
app.route("/public/model-ratings", publicModelRatings);

app.doc("/json", config);

app.get("/docs", swaggerUI({ url: "./json" }));

app.route("/", authHandler);

app.route("/v1/master", v1Master);

app.route("/v1", platformSessions);

app.route("/v1/sessions", platformSessionRefresh);

app.route("/v1/wallet", platformWallet);

app.route("/v1/customers", platformCustomers);

app.route("/v1/connect", platformConnect);

app.route("/v1/webhooks", platformWebhooks);

app.route("/v1/config", publicConfig);

app.route("/", routes);
