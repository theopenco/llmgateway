import { trace, SpanKind } from "@opentelemetry/api";
import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createTracingMiddleware } from "./middleware.js";

// Mock the logger
vi.mock("@llmgateway/logger", () => ({
	logger: {
		error: vi.fn(),
	},
}));

describe("TracingMiddleware with Force Trace Header", () => {
	let app: Hono;
	let mockTracer: any;
	let mockSpan: any;

	beforeEach(() => {
		// Create mock span
		mockSpan = {
			spanContext: vi.fn().mockReturnValue({
				traceId: "test-trace-id",
				spanId: "1234567890abcdef", // Valid hex span ID
				traceFlags: 1,
			}),
			setAttributes: vi.fn(),
			setStatus: vi.fn(),
			recordException: vi.fn(),
			end: vi.fn(),
		};

		// Create mock tracer
		mockTracer = {
			startActiveSpan: vi
				.fn()
				.mockImplementation((name, options, parentContext, fn) => {
					return fn(mockSpan);
				}),
		};

		// Mock trace.getTracer
		vi.spyOn(trace, "getTracer").mockReturnValue(mockTracer);

		// Set up Hono app with tracing middleware
		app = new Hono();
		app.use("*", createTracingMiddleware({ serviceName: "test-service" }));
		app.get("/test", (c) => c.json({ message: "success" }));
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("should capture x-force-trace header in span attributes when present with 'true'", async () => {
		const response = await app.request("/test", {
			method: "GET",
			headers: {
				"x-force-trace": "true",
			},
		});

		expect(response.status).toBe(200);

		// Verify that startActiveSpan was called with the correct attributes
		expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
			"GET /test",
			{
				kind: SpanKind.SERVER,
				attributes: expect.objectContaining({
					"http.header.x-force-trace": "true",
					"http.method": "GET",
					"http.route": "/test",
				}),
			},
			expect.anything(),
			expect.any(Function),
		);
	});

	it("should capture x-force-trace header in span attributes when present with '1'", async () => {
		const response = await app.request("/test", {
			method: "GET",
			headers: {
				"x-force-trace": "1",
			},
		});

		expect(response.status).toBe(200);

		// Verify that startActiveSpan was called with the correct attributes
		expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
			"GET /test",
			{
				kind: SpanKind.SERVER,
				attributes: expect.objectContaining({
					"http.header.x-force-trace": "1",
					"http.method": "GET",
					"http.route": "/test",
				}),
			},
			expect.anything(),
			expect.any(Function),
		);
	});

	it("should not include x-force-trace header when not present", async () => {
		const response = await app.request("/test", {
			method: "GET",
		});

		expect(response.status).toBe(200);

		// Verify that startActiveSpan was called without the force-trace header
		expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
			"GET /test",
			{
				kind: SpanKind.SERVER,
				attributes: expect.not.objectContaining({
					"http.header.x-force-trace": expect.anything(),
				}),
			},
			expect.anything(),
			expect.any(Function),
		);
	});

	it("should include x-force-trace header in attributes even with invalid value", async () => {
		const response = await app.request("/test", {
			method: "GET",
			headers: {
				"x-force-trace": "false",
			},
		});

		expect(response.status).toBe(200);

		// Verify that startActiveSpan was called with the force-trace header (even if invalid)
		expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
			"GET /test",
			{
				kind: SpanKind.SERVER,
				attributes: expect.objectContaining({
					"http.header.x-force-trace": "false",
					"http.method": "GET",
					"http.route": "/test",
				}),
			},
			expect.anything(),
			expect.any(Function),
		);
	});

	it("should add trace context to response headers", async () => {
		const response = await app.request("/test", {
			method: "GET",
			headers: {
				"x-force-trace": "true",
			},
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("x-trace-id")).toBe("test-trace-id");
		expect(response.headers.get("x-cloud-trace-context")).toBe(
			"test-trace-id/1311768467294899695;o=1", // BigInt conversion of 1234567890abcdef
		);
	});
});
