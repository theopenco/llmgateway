import { trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { createMiddleware } from "hono/factory";

import { getClientIpFromContext } from "@llmgateway/shared/client-ip";

import { clientIpMissingTotal } from "./metrics.js";

import type { Attributes } from "@opentelemetry/api";

export interface RequestLifecycleMiddlewareOptions {
	serviceName: string;
}

export function createRequestLifecycleMiddleware(
	options: RequestLifecycleMiddlewareOptions,
) {
	return createMiddleware(async (c, next) => {
		const tracer = trace.getTracer(options.serviceName);
		const method = c.req.method;
		const path = c.req.path;
		const url = c.req.url;
		const startTime = Date.now();

		// Health probes arrive in-cluster without the header and are not a signal.
		if (path !== "/" && !getClientIpFromContext(c)) {
			clientIpMissingTotal.inc({ service: options.serviceName });
		}

		const attributes: Attributes = {
			"lifecycle.service": options.serviceName,
			"lifecycle.method": method,
			"lifecycle.path": path,
			"lifecycle.url": url,
			"lifecycle.start_time": startTime,
		};

		const span = tracer.startSpan(`${method} ${path} - lifecycle`, {
			kind: SpanKind.INTERNAL,
			attributes,
		});

		try {
			await next();

			const endTime = Date.now();
			const duration = endTime - startTime;
			const status = c.res.status;

			span.setAttributes({
				"lifecycle.end_time": endTime,
				"lifecycle.duration_ms": duration,
				"lifecycle.status_code": status,
			});

			if (status >= 500) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: `Request ended with status ${status}`,
				});
			} else if (status >= 400) {
				span.setStatus({
					code: SpanStatusCode.UNSET,
					message: `Client error ${status}`,
				});
			} else {
				span.setStatus({
					code: SpanStatusCode.OK,
				});
			}
		} catch (error) {
			const endTime = Date.now();
			const duration = endTime - startTime;

			span.setAttributes({
				"lifecycle.end_time": endTime,
				"lifecycle.duration_ms": duration,
				"lifecycle.error": true,
			});

			span.recordException(
				error instanceof Error ? error : new Error(String(error)),
			);
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: error instanceof Error ? error.message : String(error),
			});

			throw error;
		} finally {
			span.end();
		}
	});
}
