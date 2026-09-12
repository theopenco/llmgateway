import {
	gatewayInflightRequests,
	gatewayRequestsShedTotal,
} from "@llmgateway/instrumentation";
import {
	INFLIGHT_LIMITED_KEYS,
	resolvePathRateLimit,
} from "@llmgateway/shared";

import { isInternalApiOrigin } from "./api-origin.js";
import { renderGatewayError } from "./error-response.js";
import { trackPendingWork } from "./pending-work.js";
import { runWithResponseCleanup } from "./response-cleanup.js";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";
import type { MiddlewareHandler } from "hono";

// Per-pod cap on concurrent in-flight inference requests. Once reached, excess
// requests are shed immediately with a retryable HTTP 529 so the load balancer
// gets a fast response instead of a hanging connection. Conservative default;
// tune from real traffic via the gateway_inflight_requests gauge.
function getMaxInflight(): number {
	const parsed = Number(process.env.GATEWAY_MAX_INFLIGHT_REQUESTS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

let inFlight = 0;

// Only inference requests are counted and shed: they can hold a connection for
// the full duration of a model call (minutes for streams), so they are what
// piles up under a slow upstream. Everything else (health, metrics, models
// listing, mcp/oauth, docs) completes near-instantly and must keep working
// while the pod sheds — probes especially, so the pod stays marked ready.
function isInferenceRequest(c: Pick<Context, "req">): boolean {
	if (c.req.method !== "POST") {
		return false;
	}
	const config = resolvePathRateLimit(c.req.path);
	return config !== null && INFLIGHT_LIMITED_KEYS.has(config.key);
}

export const backpressureMiddleware: MiddlewareHandler<ServerTypes> = async (
	c,
	next,
) => {
	if (!isInferenceRequest(c)) {
		return await next();
	}

	// Internal `app.request()` re-dispatches (messages/responses/images/ai-sdk
	// forwarding to /v1/chat/completions) run this middleware again in the same
	// process. The outer request already holds a slot; counting the hop would
	// double-count it — and shedding it would 529 a request that was already
	// admitted.
	if (isInternalApiOrigin(c)) {
		return await next();
	}

	if (inFlight >= getMaxInflight()) {
		gatewayRequestsShedTotal.inc({ scope: "pod" });
		c.header("Retry-After", "1");
		return renderGatewayError(c, 529, "Gateway overloaded, please retry");
	}

	inFlight++;
	gatewayInflightRequests.set(inFlight);

	// Tracked so graceful shutdown waits for the handler chain (billing,
	// logging) even when the client disconnects mid-request — the HTTP server
	// considers such a connection closed while the handler keeps running.
	return await trackPendingWork(
		runWithResponseCleanup(c, next, () => {
			inFlight--;
			gatewayInflightRequests.set(inFlight);
		}),
	);
};
