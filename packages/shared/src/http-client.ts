import { trace, propagation, context, SpanKind } from "@opentelemetry/api";

export interface HttpClientOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string | object;
	timeout?: number;
}

export interface HttpClientConfig {
	tracerName: string;
	clientName: string;
}

export function createHttpClient(config: HttpClientConfig) {
	return async function httpClient(
		url: string,
		options: HttpClientOptions = {},
	): Promise<Response> {
		const { method = "GET", headers = {}, body, timeout = 30000 } = options;

		// Start the client span first
		const tracer = trace.getTracer(config.tracerName);
		const span = tracer.startSpan(`HTTP ${method} ${new URL(url).pathname}`, {
			kind: SpanKind.CLIENT,
			attributes: {
				"http.method": method,
				"http.url": url,
				"http.client": config.clientName,
			},
		});

		// Create context with the client span and inject trace context into headers
		const spanContext = trace.setSpan(context.active(), span);
		const traceHeaders: Record<string, string> = {};
		propagation.inject(spanContext, traceHeaders);

		const fetchHeaders = {
			"Content-Type": "application/json",
			...headers,
			...traceHeaders,
		};

		const fetchOptions: RequestInit = {
			method,
			headers: fetchHeaders,
			signal: AbortSignal.timeout(timeout),
		};

		if (body) {
			fetchOptions.body =
				typeof body === "string" ? body : JSON.stringify(body);
		}

		try {
			// Execute the fetch within the span context
			const response = await context.with(spanContext, () =>
				fetch(url, fetchOptions),
			);

			span.setAttributes({
				"http.status_code": response.status,
				"http.response.size": response.headers.get("content-length") || "",
			});

			if (!response.ok) {
				span.setStatus({
					code: response.status >= 500 ? 2 : 1, // ERROR : OK
					message: `HTTP ${response.status}`,
				});
			}

			return response;
		} catch (error) {
			span.recordException(
				error instanceof Error ? error : new Error(String(error)),
			);
			span.setStatus({
				code: 2, // ERROR
				message: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			span.end();
		}
	};
}
