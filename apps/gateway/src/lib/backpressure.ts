import {
	gatewayInflightRequests,
	gatewayRequestsShedTotal,
} from "@llmgateway/instrumentation";

import { renderGatewayError } from "./error-response.js";

import type { ServerTypes } from "@/vars.js";
import type { MiddlewareHandler } from "hono";
import type { ServerResponse } from "node:http";

// Per-pod cap on concurrent in-flight requests. Once reached, excess requests
// are shed immediately with a retryable HTTP 529 so the load balancer gets a
// fast response instead of a hanging connection. Conservative default; tune
// from real traffic via the gateway_inflight_requests gauge.
function getMaxInflight(): number {
	const parsed = Number(process.env.GATEWAY_MAX_INFLIGHT_REQUESTS);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 1000;
}

let inFlight = 0;

// Lightweight paths that must keep working while the pod sheds load: readiness
// (`/`), metrics scraping, and the MCP/OAuth flows (which the content-type
// middleware already special-cases). These are exempt from counting so probes
// keep the pod marked ready even under overload.
function isExempt(path: string): boolean {
	return (
		path === "/" ||
		path === "/metrics" ||
		path.startsWith("/mcp") ||
		path.startsWith("/oauth")
	);
}

export const backpressureMiddleware: MiddlewareHandler<ServerTypes> = async (
	c,
	next,
) => {
	if (isExempt(c.req.path)) {
		return await next();
	}

	if (inFlight >= getMaxInflight()) {
		gatewayRequestsShedTotal.inc();
		c.header("Retry-After", "1");
		return renderGatewayError(c, 529, "Gateway overloaded, please retry");
	}

	inFlight++;
	gatewayInflightRequests.set(inFlight);

	let decremented = false;
	const decrement = () => {
		if (decremented) {
			return;
		}
		decremented = true;
		inFlight--;
		gatewayInflightRequests.set(inFlight);
	};

	// Prefer the Node adapter's raw ServerResponse 'close' event: it always fires
	// (normal completion, stream end, or client disconnect), so it's leak-proof
	// and counts long-lived streaming requests for their full duration. Fall back
	// to a finally decrement only when the raw response isn't available.
	const outgoing = (c.env as { outgoing?: ServerResponse } | undefined)
		?.outgoing;

	if (outgoing) {
		outgoing.once("close", decrement);
		return await next();
	}

	try {
		await next();
	} finally {
		decrement();
	}
};
