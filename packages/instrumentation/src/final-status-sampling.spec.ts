import { context, propagation, trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { initializeInstrumentation } from "./index.js";
import { createTracingMiddleware } from "./middleware.js";

import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

const { exported } = vi.hoisted(() => ({ exported: [] as ReadableSpan[] }));

vi.mock("@google-cloud/opentelemetry-cloud-trace-exporter", () => ({
	TraceExporter: class {
		public export(
			spans: ReadableSpan[],
			done: (result: { code: number }) => void,
		) {
			exported.push(...spans);
			done({ code: 0 });
		}
		public shutdown() {
			return Promise.resolve();
		}
	},
}));

vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
	getNodeAutoInstrumentations: () => [],
}));

afterEach(() => {
	trace.disable();
	context.disable();
	propagation.disable();
	exported.length = 0;
	vi.unstubAllEnvs();
});

describe("completed HTTP span sampling", () => {
	it.each([
		["0", "1", ["GET /missing", "GET /broken", "GET /forced"]],
		["1", "0", ["GET /ok", "GET /forced"]],
	])(
		"uses final status with normal=%s and error=%s",
		async (normal, error, names) => {
			vi.stubEnv("OTEL_SAMPLE_RATE", normal);
			vi.stubEnv("OTEL_ERROR_SAMPLE_RATE", error);
			vi.stubEnv("OTEL_METRICS_EXPORTER", "none");
			vi.stubEnv("OTEL_LOGS_EXPORTER", "none");
			const sdk = initializeInstrumentation({ serviceName: "sampling-test" });
			const app = new Hono();
			app.use("*", createTracingMiddleware({ serviceName: "sampling-test" }));
			app.get("/ok", (c) => c.text("ok"));
			app.get("/missing", (c) => c.text("missing", 404));
			app.get("/broken", (c) => c.text("broken", 500));
			app.get("/forced", (c) => c.text("forced", 500));
			try {
				for (const path of ["/ok", "/missing", "/broken", "/forced"]) {
					await app.request(path, {
						headers: path === "/forced" ? { "x-force-trace": "true" } : {},
					});
				}
			} finally {
				await sdk.shutdown();
			}
			expect(exported.map((span) => span.name).sort()).toEqual(
				[...names].sort(),
			);
			expect(
				exported.find((span) => span.name === "GET /forced")?.attributes[
					"sampling.forced"
				],
			).toBe(true);
		},
	);
});
