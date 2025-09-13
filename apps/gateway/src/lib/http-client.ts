import { trace, propagation, context } from "@opentelemetry/api";

export interface HttpClientOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string | object;
	timeout?: number;
}

export async function httpClient(
	url: string,
	options: HttpClientOptions = {},
): Promise<Response> {
	const { method = "GET", headers = {}, body, timeout = 30000 } = options;

	// Inject trace context into headers
	const activeContext = context.active();
	const traceHeaders: Record<string, string> = {};
	propagation.inject(activeContext, traceHeaders);

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
		fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
	}

	const tracer = trace.getTracer("llmgateway-gateway");
	const span = tracer.startSpan(`HTTP ${method} ${new URL(url).pathname}`, {
		attributes: {
			"http.method": method,
			"http.url": url,
			"http.client": "gateway-http-client",
		},
	});

	try {
		const response = await fetch(url, fetchOptions);

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
}
