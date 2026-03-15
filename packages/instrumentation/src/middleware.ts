import {
	trace,
	SpanKind,
	SpanStatusCode,
	context,
	propagation,
} from "@opentelemetry/api";
import { createMiddleware } from "hono/factory";

import { logger } from "@llmgateway/logger";

import type { Attributes } from "@opentelemetry/api";
import type { Context } from "hono";

export interface TracingMiddlewareOptions {
	serviceName: string;
}

export function createTracingMiddleware(options: TracingMiddlewareOptions) {
	return createMiddleware(async (c, next) => {
		const tracer = trace.getTracer(options.serviceName);
		const method = c.req.method;
		const path = c.req.path;
		const spanName = `${method} ${path}`;

		// Extract trace context from incoming headers
		const headers = Object.fromEntries(
			Object.entries(c.req.header()).map(([key, value]) => [
				key.toLowerCase(),
				value,
			]),
		);

		// Add support for X-Cloud-Trace-Context header
		const cloudTraceContext = c.req.header("x-cloud-trace-context");
		if (cloudTraceContext) {
			headers["x-cloud-trace-context"] = cloudTraceContext;
		}

		const parentContext = propagation.extract(context.active(), headers);

		// Check for force-trace header
		const forceTrace = c.req.header("x-force-trace");

		const attributes: Attributes = {
			"http.method": method,
			"http.url": c.req.url,
			"http.route": path,
			"http.user_agent": c.req.header("user-agent") ?? "",
			"http.remote_addr": getClientIp(c),
		};

		// Add force-trace header as attribute for the sampler
		if (forceTrace) {
			attributes["http.header.x-force-trace"] = forceTrace;
		}

		// Check for error-indicating headers or patterns
		const ua = (c.req.header("user-agent") ?? "").toLowerCase();
		if (/error|test/.test(ua)) {
			attributes["sampling.likely_error"] = true;
		}

		return await tracer.startActiveSpan(
			spanName,
			{
				kind: SpanKind.SERVER,
				attributes,
			},
			parentContext,
			async (span) => {
				// Add trace context to request for downstream services
				const spanContext = span.spanContext();
				c.set("traceId", spanContext.traceId);
				c.set("spanId", spanContext.spanId);

				try {
					await next();

					// Set span attributes based on response
					const status = c.res.status;
					span.setAttributes({
						"http.status_code": status,
						"http.response.size": c.res.headers.get("content-length") ?? "",
					});

					// Set span status
					if (status >= 500) {
						span.setStatus({
							code: SpanStatusCode.ERROR,
							message: "Internal Server Error",
						});
					} else if (status < 400) {
						span.setStatus({ code: SpanStatusCode.OK });
					}
					// For 4xx responses, leave status unset (default is OK without message)

					// Add trace headers to response for client correlation
					c.res.headers.set("x-trace-id", spanContext.traceId);

					// Add X-Cloud-Trace-Context header for downstream services
					const traceFlags = spanContext.traceFlags || 0;
					const samplingFlag = traceFlags & 1 ? 1 : 0;
					c.res.headers.set(
						"x-cloud-trace-context",
						`${spanContext.traceId}/${BigInt(`0x${spanContext.spanId}`).toString(10)};o=${samplingFlag}`,
					);
				} catch (error) {
					// Record exception in span
					span.recordException(
						error instanceof Error ? error : new Error(String(error)),
					);
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: error instanceof Error ? error.message : String(error),
					});

					// Log error with trace context
					logger.error(
						"Request failed",
						error instanceof Error ? error : { error: String(error) },
					);

					throw error;
				} finally {
					span.end();
				}
			},
		);
	});
}

function getClientIp(c: Context): string {
	// Enhanced client IP detection logic (from API version)
	return (
		c.req.header("cf-connecting-ip") ??
		c.req.header("x-forwarded-for")?.split(",")[0] ??
		c.req.header("remote-addr") ??
		""
	);
}
